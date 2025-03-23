// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./PokerCardLibrary.sol";
import "./PokerGameLibrary.sol";

contract OneCard {
    using CardLibrary for CardLibrary.Card[];
    using GameLibrary for uint256;
    
    // Simple ownership - contract deployer is the fixed owner/admin
    address private immutable _owner;
    
    // Game constants - public for transparency
    uint8 public constant STANDARD_DECK_SIZE = 52; // Standard 52-card deck
    uint8 public constant MAX_PLAYERS = 5; // Maximum 5 players per game
    uint256 public constant INITIAL_CHIPS = 25;    
    uint256 public constant PEEK_FEE = 5;
    uint256 public constant SWAP_FEE = 7;         
    uint256 public constant MINIMUM_BET = 1;
    
    // Timer constants - public for transparency
    uint256 public constant PEEK_PHASE_DURATION = 2 minutes;
    uint256 public constant BETTING_PHASE_DURATION = 5 minutes;

    // No whitelist in vanilla version
    
    // Player state - optimized packing (booleans together)
    struct Player {
        // Pack these booleans into a single storage slot
        bool isActive;
        bool hasPeeked;
        bool hasSwappedCard;
        bool hasFolded;
        // These fit in another slot
        uint8 cardIdx;           // Index of the player's card in the deck array
        uint256 chipBalance;
        uint256 currentBet;
        uint256 lastActionTime;  // Timestamp of player's last action (for timeout enforcement)
        // Action nonce for betting operations
        uint256 actionNonce;
    }
    
    // Game structure - optimized to reduce storage usage
    struct Game {
        uint256 gameId;
        GameLibrary.GameState state;
        address[] players;
        uint256 activePlayerCount; // Track active players to avoid recomputation
        mapping(address => Player) playerInfo;
        CardLibrary.Card[] deck;
        // Card assignment tracking - using bitmap for efficiency
        uint256 cardAssignmentBitmap; // Uses a single storage slot for all 52 cards
        uint256 potAmount;
        uint256 currentBetAmount;
        address gameKeeper;        // Service keeper that manages game transitions
        address creator;           // Player who created the game
        uint256 phaseEndTime;
        bool isCleanedUp;
    }
    
    // Game tracking
    uint256 public currentGameId;
    mapping(uint256 => Game) private games;
    mapping(address => uint256) public playerCurrentGame;
    
    // Service keeper addresses
    mapping(address => bool) private authorizedKeepers;
    
    // Basic game events - consolidated game creation event
    event GameCreated(uint256 indexed gameId, address keeper, address creator);
    event PlayerJoined(uint256 indexed gameId, address player);
    event PeekPhaseStarted(uint256 indexed gameId);
    event BettingPhaseStarted(uint256 indexed gameId);
    event ShowdownStarted(uint256 indexed gameId);
    event GameEnded(uint256 indexed gameId, address winner, uint256 potAmount);
    
    // Card-related events
    event CardDealt(uint256 indexed gameId, address indexed player);
    event CardSwapped(uint256 indexed gameId, address player); // Public event, no indexed for player
    event CardPeeked(address indexed player, uint8 value, uint8 suit); // Private to the player
    event PlayerPeeked(uint256 indexed gameId, address player); // Public notification without revealing the card
    
    // Private action events (only visible to the player who performed them)
    event PlayerAction(uint256 indexed gameId, address indexed player, string action, uint256 amount);
    
    constructor() {
        _owner = msg.sender;
        authorizedKeepers[msg.sender] = true;
    }
    
    modifier onlyOwner() {
        require(msg.sender == _owner, "Not owner");
        _;
    }
    
    modifier onlyKeeper() {
        require(authorizedKeepers[msg.sender], "Not keeper");
        _;
    }
    
    modifier gameExists(uint256 gameId) {
        require(games[gameId].gameId == gameId, "Game not found");
        _;
    }
    
    modifier activePlayer(uint256 gameId) {
        require(games[gameId].playerInfo[msg.sender].isActive, "Not active player");
        _;
    }
    
    modifier notCleanedUp(uint256 gameId) {
        require(!games[gameId].isCleanedUp, "Game already cleaned up");
        _;
    }
    
    modifier onlyCreator(uint256 gameId) {
        require(msg.sender == games[gameId].creator, "Not game creator");
        _;
    }
    
    function owner() public view returns (address) {
        return _owner;
    }

    // No whitelist functions needed for vanilla version
    
    // Bitmap operations for card assignments using GameLibrary
    function _isCardAssigned(uint256 gameId, uint8 cardIdx) private view returns (bool) {
        return GameLibrary.isCardAssigned(games[gameId].cardAssignmentBitmap, cardIdx);
    }
    
    function _assignCard(uint256 gameId, uint8 cardIdx) private {
        games[gameId].cardAssignmentBitmap = GameLibrary.assignCard(games[gameId].cardAssignmentBitmap, cardIdx);
    }
    
    function _unassignCard(uint256 gameId, uint8 cardIdx) private {
        games[gameId].cardAssignmentBitmap = GameLibrary.unassignCard(games[gameId].cardAssignmentBitmap, cardIdx);
    }
    
    function _clearCardAssignments(uint256 gameId) private {
        games[gameId].cardAssignmentBitmap = GameLibrary.clearCardAssignments();
    }
    
    // Keeper management
    function addKeeper(address keeper) external onlyOwner {
        authorizedKeepers[keeper] = true;
    }
    
    function removeKeeper(address keeper) external onlyOwner {
        authorizedKeepers[keeper] = false;
    }
    
    function isKeeper(address keeper) public view returns (bool) {
        return authorizedKeepers[keeper];
    }
    
    // Game creation - any player can create a game
    function createGame() external returns (uint256) {
        require(playerCurrentGame[msg.sender] == 0, "Already in a game");
        
        unchecked { currentGameId++; }
        uint256 gameId = currentGameId;
        
        Game storage newGame = games[gameId];
        newGame.gameId = gameId;
        newGame.state = GameLibrary.GameState.PRE_GAME;
        newGame.gameKeeper = _owner; // Default keeper is the contract owner
        newGame.creator = msg.sender;
        newGame.activePlayerCount = 0;
        newGame.isCleanedUp = false;
        
        // Emit consolidated game creation event
        emit GameCreated(gameId, _owner, msg.sender);
        
        // Auto-add creator to their own game
        _addPlayerToGame(gameId, msg.sender);
        
        return gameId;
    }
    
    // Internal helper to add a player to a game
    function _addPlayerToGame(uint256 gameId, address player) private {
        Game storage game = games[gameId];
        
        // Check if already in a game
        if (playerCurrentGame[player] != 0) return;
        
        // Add player to the game
        game.players.push(player);
        Player storage playerData = game.playerInfo[player];
        playerData.isActive = true;
        playerData.chipBalance = INITIAL_CHIPS;
        playerData.lastActionTime = block.timestamp;
        playerData.actionNonce = 0;
        
        // Track which game the player is in
        playerCurrentGame[player] = gameId;
        
        // Increment active player count
        unchecked { game.activePlayerCount++; }
        
        emit PlayerJoined(gameId, player);
    }
    
    // Any player can join the game 
    function joinGame(uint256 gameId) external gameExists(gameId) notCleanedUp(gameId) {
        Game storage game = games[gameId];
        
        require(game.state == GameLibrary.GameState.PRE_GAME, "Game has already started");
        require(game.players.length < MAX_PLAYERS, "Game full");
        require(playerCurrentGame[msg.sender] == 0, "Already in a game");
        
        // Add player to game
        game.players.push(msg.sender);
        Player storage playerData = game.playerInfo[msg.sender];
        playerData.isActive = true;
        playerData.chipBalance = INITIAL_CHIPS;
        playerData.lastActionTime = block.timestamp;
        playerData.actionNonce = 0;
        
        // Track which game the player is in
        playerCurrentGame[msg.sender] = gameId;
        
        // Increment active player count
        unchecked { game.activePlayerCount++; }
        
        emit PlayerJoined(gameId, msg.sender);
    }
    
    // We don't need addPlayerToGame since players use joinGame directly
    
    // Game creator starts the game (peek phase)
    function startGame(uint256 gameId) external gameExists(gameId) notCleanedUp(gameId) onlyCreator(gameId) {
        Game storage game = games[gameId];
        
        require(game.state == GameLibrary.GameState.PRE_GAME, "Game has already started");
        require(game.players.length >= 2, "Need 2+ players");
        
        // Set timeframe for the peek phase - no buffer period
        game.phaseEndTime = block.timestamp + PEEK_PHASE_DURATION;
        
        // Move to peek phase
        game.state = GameLibrary.GameState.PEEK_PHASE;
        
        // Initialize and shuffle the deck using Fisher-Yates algorithm
        _initializeDeck(gameId);
        
        // Deal cards to players
        _dealCards(gameId);
        
        // Emit peek phase started event
        emit PeekPhaseStarted(gameId);
    }
    
    // Helper function to initialize the deck with Fisher-Yates shuffle
    function _initializeDeck(uint256 gameId) private {
        Game storage game = games[gameId];
        
        // Clear any existing cards
        delete game.deck;
        
        // Create a standard sized deck first using CardLibrary
        CardLibrary.Card[] memory initialDeck = new CardLibrary.Card[](STANDARD_DECK_SIZE);
        uint8 index = 0;
        
        // Create a standard 52-card deck
        for (uint8 suit = 0; suit < 4; suit++) {
            for (uint8 value = 2; value <= 14; value++) {
                initialDeck[index] = CardLibrary.Card(value, suit);
                index++;
            }
        }
        
        // Use the shuffleDeck function from the CardLibrary
        CardLibrary.Card[] memory shuffledDeck = CardLibrary.shuffleDeck(initialDeck);
        
        // Update the game deck with the shuffled deck
        for (uint i = 0; i < STANDARD_DECK_SIZE; i++) {
            game.deck.push(shuffledDeck[i]);
        }
    }
    
    // Helper function to deal cards - using bitmap for efficiency
    function _dealCards(uint256 gameId) private {
        Game storage game = games[gameId];
        
        // Clear all card assignments with a single operation
        _clearCardAssignments(gameId);
        
        // Deal cards to players
        for (uint256 i = 0; i < game.players.length; i++) {
            address player = game.players[i];
            uint8 cardIdx = uint8(i);
            game.playerInfo[player].cardIdx = cardIdx;
            _assignCard(gameId, cardIdx);
            
            // Emit event to notify player they've been dealt a card (without revealing which card)
            emit CardDealt(gameId, player);
        }
    }
    
    // Function for a player to peek at their card
    function peekAtCard(uint256 gameId) external gameExists(gameId) activePlayer(gameId) notCleanedUp(gameId) {
        Game storage game = games[gameId];
        Player storage player = game.playerInfo[msg.sender];
        
        require(game.state == GameLibrary.GameState.PEEK_PHASE, "Not peek phase");
        require(block.timestamp < game.phaseEndTime, "Peek phase ended");
        require(!player.hasPeeked, "Already peeked");
        require(player.chipBalance >= PEEK_FEE, "Insufficient chips");
        
        // Deduct the peek fee
        unchecked { player.chipBalance -= PEEK_FEE; }
        player.hasPeeked = true;
        player.lastActionTime = block.timestamp;
        
        // Increment action nonce
        unchecked { player.actionNonce++; }
        
        // Get the player's card
        uint8 cardIdx = player.cardIdx;
        CardLibrary.Card memory playerCard = game.deck[cardIdx];
        
        // Private event to notify only the player of their card
        emit CardPeeked(msg.sender, playerCard.value, playerCard.suit);
        
        // Public event to notify all players that this player has peeked
        emit PlayerPeeked(gameId, msg.sender);
        
        // Private player action confirmation
        emit PlayerAction(gameId, msg.sender, "peek", PEEK_FEE);
    }
    
    // Function to swap card - only available if player has peeked
    function swapCard(uint256 gameId) external gameExists(gameId) activePlayer(gameId) notCleanedUp(gameId) {
        Game storage game = games[gameId];
        Player storage player = game.playerInfo[msg.sender];
        
        require(game.state == GameLibrary.GameState.PEEK_PHASE, "Not peek phase");
        require(block.timestamp < game.phaseEndTime, "Peek phase ended");
        require(player.hasPeeked, "Must peek at card first");
        require(!player.hasSwappedCard, "Already used swap option");
        require(player.chipBalance >= SWAP_FEE, "Insufficient chips");
        
        // Update player state
        unchecked { player.chipBalance -= SWAP_FEE; }
        player.hasSwappedCard = true;
        player.lastActionTime = block.timestamp;
        unchecked { player.actionNonce++; }
        
        // Get current card index before swapping
        uint8 currentCardIdx = player.cardIdx;
        
        // Mark the current card as unassigned
        _unassignCard(gameId, currentCardIdx);
        
        // Get a new unassigned card from the deck
        uint8 newCardIdx = _getRandomUnassignedCard(gameId);
        
        // Explicit state check for card swap
        require(newCardIdx > 0 && newCardIdx < STANDARD_DECK_SIZE, "Invalid new card index");
        require(!_isCardAssigned(gameId, newCardIdx), "New card already assigned");
        
        // Mark the new card as assigned and update player
        _assignCard(gameId, newCardIdx);
        player.cardIdx = newCardIdx;
        
        // Do NOT reveal the new card to the player - they've already used their peek
        // Player won't be able to see what card they received after swapping
        
        // Public event to notify all players that this player has swapped their card
        emit CardSwapped(gameId, msg.sender);
        
        // Private player action confirmation
        emit PlayerAction(gameId, msg.sender, "swap", SWAP_FEE);
    }
    
    // Helper to get a random unassigned card for card swap
    function _getRandomUnassignedCard(uint256 gameId) private view returns (uint8) {
        Game storage game = games[gameId];
        
        // Find all unassigned card indices
        uint8[] memory eligibleIndices = new uint8[](STANDARD_DECK_SIZE);
        uint16 eligibleCount = 0;
        
        for (uint8 i = 0; i < game.deck.length; i++) {
            if (!_isCardAssigned(gameId, i)) {
                eligibleIndices[eligibleCount] = i;
                eligibleCount++;
            }
        }
        
        require(eligibleCount > 0, "No available cards for swap");
        
        // Select a random eligible card
        uint16 randomIndex = uint16(uint256(keccak256(abi.encodePacked(block.difficulty, block.timestamp))) % eligibleCount);
        return eligibleIndices[randomIndex];
    }
    
    // Keeper ends peek phase and starts betting phase
    function endPeekPhase(uint256 gameId) external onlyKeeper gameExists(gameId) notCleanedUp(gameId) {
        Game storage game = games[gameId];
        
        require(game.state == GameLibrary.GameState.PEEK_PHASE, "Not peek phase");
        require(block.timestamp >= game.phaseEndTime, "Peek phase not finished");
        
        // Set betting phase end time - no buffer period
        game.phaseEndTime = block.timestamp + BETTING_PHASE_DURATION;
        
        // Start betting phase
        game.state = GameLibrary.GameState.BETTING;
        
        // Emit betting phase started
        emit BettingPhaseStarted(gameId);
    }
    
    // Function for players to place bets - only allowed once per player during betting phase
    function placeBet(uint256 gameId, uint256 betAmount) external gameExists(gameId) activePlayer(gameId) notCleanedUp(gameId) {
        Game storage game = games[gameId];
        Player storage player = game.playerInfo[msg.sender];
        
        require(game.state == GameLibrary.GameState.BETTING, "Not betting phase");
        require(block.timestamp < game.phaseEndTime, "Betting phase ended");
        require(!player.hasFolded, "Already folded");
        require(betAmount >= MINIMUM_BET, "Bet too small");
        require(player.currentBet == 0, "Already placed a bet");
        
        // If there's already a bet in this round, we must match or raise
        if (game.currentBetAmount > 0) {
            require(betAmount >= game.currentBetAmount, "Must match current bet");
        }
        
        require(player.chipBalance >= betAmount, "Insufficient chips");
        
        // Increment action nonce
        unchecked { player.actionNonce++; }
        
        // Place the bet
        unchecked {
            player.chipBalance -= betAmount;
            player.currentBet = betAmount; // Set bet amount (not add)
            game.potAmount += betAmount;
        }
        player.lastActionTime = block.timestamp;
        
        // Update the current bet if this is a raise
        if (player.currentBet > game.currentBetAmount) {
            game.currentBetAmount = player.currentBet;
        }
        
        // Private player action confirmation
        emit PlayerAction(gameId, msg.sender, "bet", betAmount);
    }
    
    // Function for players to fold
    function fold(uint256 gameId) external gameExists(gameId) activePlayer(gameId) notCleanedUp(gameId) {
        Game storage game = games[gameId];
        Player storage player = game.playerInfo[msg.sender];
        
        require(game.state == GameLibrary.GameState.BETTING, "Not betting phase");
        require(block.timestamp < game.phaseEndTime, "Betting phase ended");
        require(!player.hasFolded, "Already folded");
        
        // Increment action nonce
        unchecked { player.actionNonce++; }
        
        player.hasFolded = true;
        player.lastActionTime = block.timestamp;
        
        // Update active player count
        unchecked { game.activePlayerCount--; }
        
        // Private player action confirmation
        emit PlayerAction(gameId, msg.sender, "fold", 0);
        
        // Check if only one player remains
        if (game.activePlayerCount == 1) {
            address lastActivePlayer = _findLastActivePlayer(gameId);
            
            // Award chips directly to the last active player
            unchecked { game.playerInfo[lastActivePlayer].chipBalance += game.potAmount; }
            
            // Capture pot amount before resetting
            uint256 potAmount = game.potAmount;
            
            // Move game to ended state
            game.state = GameLibrary.GameState.ENDED;
            
            // Emit game ended event
            emit GameEnded(gameId, lastActivePlayer, potAmount);
            
            // Reset game state for cleanup
            game.potAmount = 0;
            game.currentBetAmount = 0;
        }
    }
    
    // Helper to find the last active player after a fold
    function _findLastActivePlayer(uint256 gameId) private view returns (address) {
        Game storage game = games[gameId];
        
        for (uint256 i = 0; i < game.players.length; i++) {
            address player = game.players[i];
            if (!game.playerInfo[player].hasFolded) {
                return player;
            }
        }
        
        // This should never be reached if activePlayerCount is maintained properly
        revert("No active players found");
    }
    
    // Keeper ends betting phase and moves to showdown
    function endBettingPhase(uint256 gameId) external onlyKeeper gameExists(gameId) notCleanedUp(gameId) {
        Game storage game = games[gameId];
        
        require(game.state == GameLibrary.GameState.BETTING, "Not betting phase");
        require(block.timestamp >= game.phaseEndTime, "Betting phase not finished");
        
        _startShowdown(gameId);
    }
    
    // Start the showdown phase
    function _startShowdown(uint256 gameId) private {
        Game storage game = games[gameId];
        
        // Update game state
        game.state = GameLibrary.GameState.SHOWDOWN;
        
        emit ShowdownStarted(gameId);
        
        // Determine winner during showdown
        _determineWinner(gameId);
    }
    
    // Determine the winner at showdown and award pot
    function _determineWinner(uint256 gameId) private {
        Game storage game = games[gameId];
        
        address winner = _findHighestCardPlayer(gameId);
        
        // Reveal all cards
        for (uint256 i = 0; i < game.players.length; i++) {
            address player = game.players[i];
            
            // Skip folded players
            if (game.playerInfo[player].hasFolded) continue;
            
            // Reveal card to all players
            uint8 cardIdx = game.playerInfo[player].cardIdx;
            CardLibrary.Card memory playerCard = game.deck[cardIdx];
            emit CardPeeked(player, playerCard.value, playerCard.suit);
        }
        
        // Award chips directly to the winner
        unchecked { game.playerInfo[winner].chipBalance += game.potAmount; }
        
        // Capture pot amount before resetting
        uint256 potAmount = game.potAmount;
        
        // Move game to ended state
        game.state = GameLibrary.GameState.ENDED;
        
        // Emit game ended event
        emit GameEnded(gameId, winner, potAmount);
        
        // Reset game state for cleanup
        game.potAmount = 0;
        game.currentBetAmount = 0;
    }
    
    // Helper function to find the player with the highest card
    function _findHighestCardPlayer(uint256 gameId) private view returns (address) {
        Game storage game = games[gameId];
        
        address winner;
        uint8 highestValue = 0;
        uint8 highestSuit = 0;
        
        for (uint256 i = 0; i < game.players.length; i++) {
            address player = game.players[i];
            
            // Skip folded players
            if (game.playerInfo[player].hasFolded) continue;
            
            uint8 cardIdx = game.playerInfo[player].cardIdx;
            CardLibrary.Card memory playerCard = game.deck[cardIdx];
            
            // Check if this card is higher - simplified logic
            if (playerCard.value > highestValue || 
                (playerCard.value == highestValue && playerCard.suit > highestSuit)) {
                highestValue = playerCard.value;
                highestSuit = playerCard.suit;
                winner = player;
            }
        }
        
        return winner;
    }
    
    // Award pot function removed - functionality integrated into _determineWinner and fold
    
    // Check if all players have either placed a bet or folded - for keeper service
    function checkAllPlayersMatched(uint256 gameId) external view gameExists(gameId) returns (bool) {
        Game storage game = games[gameId];
        
        if (game.state != GameLibrary.GameState.BETTING) {
            return false;
        }
        
        // Check if all players have either bet or folded
        for (uint256 i = 0; i < game.players.length; i++) {
            address player = game.players[i];
            
            // Skip folded players
            if (game.playerInfo[player].hasFolded) continue;
            
            // Check if player has placed a bet
            if (game.playerInfo[player].currentBet == 0) {
                return false; // Player hasn't acted yet
            }
            
            // With our updated betting model, we don't need to check if a player matched
            // the current bet since they can only bet once
        }
        
        return true;
    }
    
    // Get active player count using the cached value
    function getActivePlayerCount(uint256 gameId) external view gameExists(gameId) returns (uint256) {
        return games[gameId].activePlayerCount;
    }
    
    // Get basic game information - UI can poll this to get the latest public game data
    function getGameInfo(uint256 gameId) external view gameExists(gameId) returns (
        GameLibrary.GameState state,
        uint256 potAmount,
        uint256 currentBet,
        uint256 phaseEndTime,
        uint256 remainingTime,
        uint256 playerCount,
        uint256 activeCount,
        address creator,
        bool isCleanedUp
    ) {
        Game storage game = games[gameId];
        uint256 remaining = 0;
        
        if (block.timestamp < game.phaseEndTime) {
            remaining = game.phaseEndTime - block.timestamp;
        }
        
        return (
            game.state,
            game.potAmount,
            game.currentBetAmount,
            game.phaseEndTime,
            remaining,
            game.players.length,
            game.activePlayerCount,
            game.creator,
            game.isCleanedUp
        );
    }
    
    // Get player information - only returns information the player is allowed to see
    function getPlayerInfo(uint256 gameId, address player) external view gameExists(gameId) returns (
        bool isActive,
        bool hasPeeked,
        bool hasSwappedCard,
        bool hasFolded,
        uint256 chipBalance,
        uint256 currentBet
    ) {
        Game storage game = games[gameId];
        Player storage playerData = game.playerInfo[player];
        
        // Only the player should see their private info - keepers don't need to see player info
        if (msg.sender != player) {
            // Return public and limited information if not the player
            return (
                playerData.isActive,
                playerData.hasPeeked, // Reveal if they've peeked - this is public
                playerData.hasSwappedCard, // Reveal if they've swapped - this is public
                playerData.hasFolded,
                playerData.chipBalance,
                playerData.currentBet
            );
        }
        
        return (
            playerData.isActive,
            playerData.hasPeeked,
            playerData.hasSwappedCard,
            playerData.hasFolded,
            playerData.chipBalance,
            playerData.currentBet
        );
    }
    
    // Get all players in a single call
    function getPlayers(uint256 gameId) external view gameExists(gameId) returns (
        address[] memory players
    ) {
        return games[gameId].players;
    }
    
    // Get active players in a single call
    function getActivePlayers(uint256 gameId) external view gameExists(gameId) returns (address[] memory activePlayers) {
        Game storage game = games[gameId];
        
        // Use the cached active player count
        activePlayers = new address[](game.activePlayerCount);
        
        if (game.activePlayerCount == 0) {
            return activePlayers;
        }
        
        uint256 index = 0;
        
        // Fill active players
        for (uint256 i = 0; i < game.players.length; i++) {
            address player = game.players[i];
            if (!game.playerInfo[player].hasFolded) {
                activePlayers[index] = player;
                unchecked { index++; }
                
                // Early exit if we've found all active players
                if (index >= game.activePlayerCount) {
                    break;
                }
            }
        }
    }
    
    // Function for a player to leave the game if it hasn't started
    function leaveGame(uint256 gameId) external gameExists(gameId) notCleanedUp(gameId) {
        Game storage game = games[gameId];
        
        require(game.playerInfo[msg.sender].isActive, "Not in this game");
        require(game.state == GameLibrary.GameState.PRE_GAME, "Game already started");
        
        // Creator can't leave their own game
        require(msg.sender != game.creator || game.players.length == 1, "Creator can't leave game with other players");
        
        // Find and remove the player
        for (uint256 i = 0; i < game.players.length; i++) {
            if (game.players[i] == msg.sender) {
                // Replace with the last player in the array
                game.players[i] = game.players[game.players.length - 1];
                game.players.pop();
                break;
            }
        }
        
        // Update active player count
        unchecked { game.activePlayerCount--; }
        
        // Clear player data
        delete game.playerInfo[msg.sender];
        playerCurrentGame[msg.sender] = 0;
        
        // Private player action confirmation
        emit PlayerAction(gameId, msg.sender, "leave", 0);
    }
    
    // Function to clean up after a game
    function cleanup(uint256 gameId) external onlyKeeper gameExists(gameId) notCleanedUp(gameId) {
        Game storage game = games[gameId];
        
        require(game.state == GameLibrary.GameState.ENDED, "Game not ended");
        
        // Clear the player's current game tracking
        for (uint256 i = 0; i < game.players.length; i++) {
            address player = game.players[i];
            playerCurrentGame[player] = 0;
        }
        
        // Mark game as cleaned up
        game.isCleanedUp = true;
    }
}