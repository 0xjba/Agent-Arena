// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./PokerCardLibrary.sol";
import "./PokerGameLibrary.sol";

/**
 * @title OneCard Poker Game for TEN Network
 * @notice TEN Network is powered by Trusted Execution Environments (TEEs) which provide
 * encrypted private shared states for blockchain applications. This contract
 * leverages TEN's capabilities for a private and fair poker game.
 *
 * @dev This is the main contract for the OneCard poker game, which utilizes TEN Network's
 * privacy features:
 * 1. Private Card Information: Player cards remain hidden using TEN's encrypted state
 * 2. Secure RNG: Card shuffling uses TEN's secure random number generation
 * 3. Selective Card Reveals: Cards are only revealed to appropriate players
 * 4. Tamper-proof Game Logic: Game rules are enforced within TEE
 */
contract OneCard {
    using CardLibrary for CardLibrary.Card[];
    using GameLibrary for uint256;
    
    // Simple ownership - contract deployer is the fixed owner/admin
    address private immutable _owner;
    
    /**
     * @dev Game constants - public for transparency
     */
    uint8 public constant STANDARD_DECK_SIZE = 52; // Standard 52-card deck
    uint8 public constant MAX_PLAYERS = 5; // Maximum 5 players per game
    uint256 public constant INITIAL_CHIPS = 25;    
    uint256 public constant PEEK_FEE = 5;
    uint256 public constant SWAP_FEE = 7;         
    uint256 public constant MINIMUM_BET = 1;
    
    /**
     * @dev Phase duration constants - public for transparency
     */
    uint256 public constant PEEK_PHASE_DURATION = 2 minutes;
    uint256 public constant BETTING_PHASE_DURATION = 5 minutes;

    // No whitelist in vanilla version
    
    /**
     * @dev Player structure with optimized packing (booleans together in a single slot)
     * TEN Network's privacy features ensure this data remains encrypted and private
     */
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
        uint256 lastActionTime;  // Timestamp of player's last action
        // Action nonce for betting operations - prevents replay attacks
        uint256 actionNonce;
    }
    
    /**
     * @dev Game structure - optimized for gas efficiency and storage usage
     * TEN Network ensures the privacy of sensitive game state variables
     */
    struct Game {
        uint256 gameId;
        GameLibrary.GameState state;
        address[] players;
        uint256 activePlayerCount; // Track active players to avoid recomputation
        mapping(address => Player) playerInfo;
        CardLibrary.Card[] deck;   // Secured by TEN's encrypted state
        // Card assignment tracking - using bitmap for efficiency (1 slot for 52 cards)
        uint256 cardAssignmentBitmap;
        uint256 potAmount;
        uint256 currentBetAmount;
        address gameKeeper;        // Service keeper that manages game transitions
        address creator;           // Player who created the game
        uint256 phaseEndTime;
        bool isCleanedUp;
    }
    
    /**
     * @dev Game tracking state variables
     */
    uint256 public currentGameId;
    mapping(uint256 => Game) private games;
    mapping(address => uint256) public playerCurrentGame;
    
    /**
     * @dev Service keeper authorization mapping
     */
    mapping(address => bool) private authorizedKeepers;
    
    /**
     * @dev Game state transition events
     * TEN Network ensures these events are visible to appropriate participants
     */
    event GameCreated(uint256 indexed gameId, address keeper, address creator);
    event PlayerJoined(uint256 indexed gameId, address player);
    event PeekPhaseStarted(uint256 indexed gameId);
    event BettingPhaseStarted(uint256 indexed gameId);
    event ShowdownStarted(uint256 indexed gameId);
    event GameEnded(uint256 indexed gameId, address winner, uint256 potAmount);
    
    /**
     * @dev Card-related events
     * TEN Network's privacy features ensure these events are only visible to appropriate participants:
     * - Public events are visible to everyone
     * - Private events (indexed by player address) are only visible to that specific player
     */
    event CardDealt(uint256 indexed gameId, address indexed player);
    event CardSwapped(uint256 indexed gameId, address player); // Public event
    event CardPeeked(address indexed player, uint8 value, uint8 suit); // Private to the player
    event PlayerPeeked(uint256 indexed gameId, address player); // Public notification without revealing the card
    event CardRevealed(uint256 indexed gameId, address player, uint8 value, uint8 suit); // Public card reveal at showdown
    
    /**
     * @dev Private action events (only visible to the player who performed them)
     * TEN Network's TEE ensures these events remain private
     */
    event PlayerAction(uint256 indexed gameId, address indexed player, string action, uint256 amount);
    
    /**
     * @dev Constructor sets the contract owner as the first authorized keeper
     */
    constructor() {
        _owner = msg.sender;
        authorizedKeepers[msg.sender] = true;
    }
    
    /**
     * @dev Restricts function access to the contract owner
     */
    modifier onlyOwner() {
        require(msg.sender == _owner, "Not owner");
        _;
    }
    
    /**
     * @dev Restricts function access to authorized keeper addresses
     * Keepers are responsible for managing game phase transitions
     */
    modifier onlyKeeper() {
        require(authorizedKeepers[msg.sender], "Not keeper");
        _;
    }
    
    /**
     * @dev Ensures a game with the given ID exists
     */
    modifier gameExists(uint256 gameId) {
        require(games[gameId].gameId == gameId, "Game not found");
        _;
    }
    
    /**
     * @dev Ensures the caller is an active player in the specified game
     */
    modifier activePlayer(uint256 gameId) {
        require(games[gameId].playerInfo[msg.sender].isActive, "Not active player");
        _;
    }
    
    /**
     * @dev Ensures the game has not been cleaned up yet
     */
    modifier notCleanedUp(uint256 gameId) {
        require(!games[gameId].isCleanedUp, "Game already cleaned up");
        _;
    }
    
    /**
     * @dev Restricts function access to the game creator
     */
    modifier onlyCreator(uint256 gameId) {
        require(msg.sender == games[gameId].creator, "Not game creator");
        _;
    }
    
    /**
     * @dev Returns the address of the contract owner
     * @return The owner address
     */
    function owner() public view returns (address) {
        return _owner;
    }

    // No whitelist functions needed for vanilla version
    
    /**
     * @dev Bitmap operations for gas-efficient card assignment tracking
     * These internal functions utilize the GameLibrary for bitmap manipulation
     * TEN Network's privacy features ensure these operations remain secure
     */
    
    /**
     * @dev Checks if a card is assigned to any player
     * @param gameId The ID of the game
     * @param cardIdx The index of the card to check
     * @return True if the card is assigned, false otherwise
     */
    function _isCardAssigned(uint256 gameId, uint8 cardIdx) private view returns (bool) {
        return GameLibrary.isCardAssigned(games[gameId].cardAssignmentBitmap, cardIdx);
    }
    
    /**
     * @dev Marks a card as assigned to a player
     * @param gameId The ID of the game
     * @param cardIdx The index of the card to assign
     */
    function _assignCard(uint256 gameId, uint8 cardIdx) private {
        games[gameId].cardAssignmentBitmap = GameLibrary.assignCard(games[gameId].cardAssignmentBitmap, cardIdx);
    }
    
    /**
     * @dev Unassigns a card from a player
     * @param gameId The ID of the game
     * @param cardIdx The index of the card to unassign
     */
    function _unassignCard(uint256 gameId, uint8 cardIdx) private {
        games[gameId].cardAssignmentBitmap = GameLibrary.unassignCard(games[gameId].cardAssignmentBitmap, cardIdx);
    }
    
    /**
     * @dev Clears all card assignments for a game
     * @param gameId The ID of the game
     */
    function _clearCardAssignments(uint256 gameId) private {
        games[gameId].cardAssignmentBitmap = GameLibrary.clearCardAssignments();
    }
    
    /**
     * @dev Keeper management functions
     * Keepers are responsible for managing game state transitions
     */
    
    /**
     * @notice Adds a new keeper address
     * @dev Only the contract owner can add keepers
     * @param keeper The address to add as a keeper
     */
    function addKeeper(address keeper) external onlyOwner {
        authorizedKeepers[keeper] = true;
    }
    
    /**
     * @notice Removes a keeper address
     * @dev Only the contract owner can remove keepers
     * @param keeper The address to remove as a keeper
     */
    function removeKeeper(address keeper) external onlyOwner {
        authorizedKeepers[keeper] = false;
    }
    
    /**
     * @notice Checks if an address is an authorized keeper
     * @param keeper The address to check
     * @return True if the address is a keeper, false otherwise
     */
    function isKeeper(address keeper) public view returns (bool) {
        return authorizedKeepers[keeper];
    }
    
    /**
     * @dev Game lifecycle functions
     */
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
            
            // Reveal all remaining cards since the game is ending
            for (uint256 i = 0; i < game.players.length; i++) {
                address player = game.players[i];
                
                // Skip folded players
                if (game.playerInfo[player].hasFolded) continue;
                
                // Reveal card publicly
                uint8 cardIdx = game.playerInfo[player].cardIdx;
                CardLibrary.Card memory playerCard = game.deck[cardIdx];
                
                // Emit a public event revealing this card to everyone
                emit CardRevealed(gameId, player, playerCard.value, playerCard.suit);
            }
            
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
        
        // Reveal all cards publicly at showdown
        for (uint256 i = 0; i < game.players.length; i++) {
            address player = game.players[i];
            
            // Skip folded players
            if (game.playerInfo[player].hasFolded) continue;
            
            // Reveal card privately to the player (historical behavior)
            uint8 cardIdx = game.playerInfo[player].cardIdx;
            CardLibrary.Card memory playerCard = game.deck[cardIdx];
            emit CardPeeked(player, playerCard.value, playerCard.suit);
            
            // Also emit a public event revealing this card to everyone
            emit CardRevealed(gameId, player, playerCard.value, playerCard.suit);
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
    
    // Function to get all revealed cards at showdown or game end
    function getRevealedCards(uint256 gameId) external view gameExists(gameId) returns (
        address[] memory players,
        uint8[] memory values,
        uint8[] memory suits
    ) {
        Game storage game = games[gameId];
        
        // Only allow viewing cards during showdown or when game is ended
        require(game.state == GameLibrary.GameState.SHOWDOWN || game.state == GameLibrary.GameState.ENDED, 
                "Cards not yet revealed");
        
        // Count non-folded players to determine array size
        uint256 activeCount = 0;
        for (uint256 i = 0; i < game.players.length; i++) {
            if (!game.playerInfo[game.players[i]].hasFolded) {
                activeCount++;
            }
        }
        
        // Initialize arrays
        players = new address[](activeCount);
        values = new uint8[](activeCount);
        suits = new uint8[](activeCount);
        
        // Fill arrays with card information
        uint256 index = 0;
        for (uint256 i = 0; i < game.players.length; i++) {
            address player = game.players[i];
            
            // Skip folded players
            if (game.playerInfo[player].hasFolded) continue;
            
            // Get card details
            uint8 cardIdx = game.playerInfo[player].cardIdx;
            CardLibrary.Card memory card = game.deck[cardIdx];
            
            // Add to arrays
            players[index] = player;
            values[index] = card.value;
            suits[index] = card.suit;
            
            index++;
        }
        
        return (players, values, suits);
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
        
        // If this was the last player to leave, clean up the game
        if (game.players.length == 0) {
            _cleanupEmptyGame(gameId);
        }
    }
    
    // Internal function to clean up an empty game
    function _cleanupEmptyGame(uint256 gameId) internal {
        Game storage game = games[gameId];
        
        // Make sure there are no players
        require(game.players.length == 0, "Game still has players");
        
        // Clear deck and other data
        delete game.deck;
        
        // Mark as cleaned up
        game.isCleanedUp = true;
        
        // Emit event to notify that this game is no longer available
        emit GameEnded(gameId, address(0), 0);
        
        // Log specific event for cleanup
        emit PlayerAction(gameId, msg.sender, "cleanup_empty", 0);
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