// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract OneCard {
    address private immutable _owner;
    
    // Game constants
    uint8 private constant STANDARD_DECK_SIZE = 52;
    uint8 private constant MAX_PLAYERS = 10;
    uint256 private constant INITIAL_CHIPS = 40;
    uint256 private constant PEEK_FEE = 5;
    uint256 private constant SWAP_FEE = 8;
    uint256 private constant MINIMUM_BET = 1;
    
    // Timer constants
    uint256 private constant PEEK_PHASE_DURATION = 2 minutes;
    uint256 private constant BETTING_PHASE_DURATION = 5 minutes;

    // Whitelist tracking
    mapping(address => bool) private whitelistedPlayers;
    address[] private whitelistedPlayersList;
    
    // Card representations (2-14, where 11=J, 12=Q, 13=K, 14=A)
    struct Card {
        uint8 value; // 2-14
        uint8 suit;  // 0-3 (0=Hearts, 1=Diamonds, 2=Clubs, 3=Spades)
    }

    // Game state definitions
    enum GameState { 
        REGISTRATION,  // Accepting players
        PEEK_PHASE,    // Players can peek/swap cards
        BETTING,       // Players place bets
        SHOWDOWN,      // Cards revealed, winner determined
        ENDED          // Game completed
    }
    
    // Player state
    struct Player {
        bool isActive;
        bool hasPeeked;
        bool hasSwapped;
        uint8 cardIdx;
        uint256 chipBalance;
        uint256 currentBet;
        bool hasFolded;
        uint256 lastActionTime;
    }
    
    // Game structure
    struct Game {
        uint256 gameId;
        GameState state;
        address[] players;
        mapping(address => Player) playerInfo;
        Card[] deck;
        uint256 potAmount;
        uint256 currentBetAmount;
        address gameKeeper;
        uint256 phaseStartTime;
        uint256 phaseEndTime;
    }
    
    // Game tracking
    uint256 private currentGameId;
    mapping(uint256 => Game) private games;
    mapping(address => uint256) private playerCurrentGame;
    
    // Service keeper addresses
    mapping(address => bool) private authorizedKeepers;
    
    // Events for game state updates
    event GameCreated(uint256 indexed gameId, address keeper);
    event PlayerJoined(uint256 indexed gameId, address indexed player);
    event PeekPhaseStarted(uint256 indexed gameId, uint256 duration, uint256 endTime);
    event PlayerPeeked(uint256 indexed gameId, address indexed player);
    event PlayerSwappedCard(uint256 indexed gameId, address indexed player);
    event BettingPhaseStarted(uint256 indexed gameId, uint256 duration, uint256 endTime);
    event PlayerBet(uint256 indexed gameId, address indexed player, uint256 amount);
    event PlayerFolded(uint256 indexed gameId, address indexed player);
    event ShowdownStarted(uint256 indexed gameId);
    event GameEnded(uint256 indexed gameId, address indexed winner, uint256 potAmount);
    
    // Whitelist events
    event PlayersWhitelisted(address[] players);
    event PlayersRemovedFromWhitelist(address[] players);
    
    // Private notifications for cards (only visible to the player)
    event CardRevealed(address indexed player, uint8 value, uint8 suit);
    
    // Constructor
    constructor() {
        _owner = msg.sender;
        
        authorizedKeepers[msg.sender] = true;
        
        whitelistedPlayers[msg.sender] = true;
        whitelistedPlayersList.push(msg.sender);
    }
    
    // Owner check modifier
    modifier onlyOwner() {
        require(msg.sender == _owner, "Only owner can call this function");
        _;
    }
    
    // Keeper check modifier
    modifier onlyKeeper() {
        require(authorizedKeepers[msg.sender], "Only authorized keepers can call this function");
        _;
    }
    
    // Return the owner address
    function owner() public view returns (address) {
        return _owner;
    }
    
    // Whitelist management functions
    function addMultipleToWhitelist(address[] calldata players) external onlyOwner {
        for (uint i = 0; i < players.length; i++) {
            if (!whitelistedPlayers[players[i]]) {
                whitelistedPlayers[players[i]] = true;
                whitelistedPlayersList.push(players[i]);
            }
        }
        emit PlayersWhitelisted(players);
    }
    
    function removeMultipleFromWhitelist(address[] calldata players) external onlyOwner {
        for (uint i = 0; i < players.length; i++) {
            if (whitelistedPlayers[players[i]]) {
                whitelistedPlayers[players[i]] = false;
            }
        }
        emit PlayersRemovedFromWhitelist(players);
    }
    
    function isWhitelisted(address player) public view returns (bool) {
        return whitelistedPlayers[player];
    }
    
    // Get all whitelisted players
    function getWhitelistedPlayers() external view returns (address[] memory) {
        uint256 validCount = 0;
        for (uint256 i = 0; i < whitelistedPlayersList.length; i++) {
            if (whitelistedPlayers[whitelistedPlayersList[i]]) {
                validCount++;
            }
        }
        
        address[] memory result = new address[](validCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < whitelistedPlayersList.length; i++) {
            address player = whitelistedPlayersList[i];
            if (whitelistedPlayers[player]) {
                result[index] = player;
                index++;
            }
        }
        
        return result;
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
    
    // Game creation and management
    function createGame() external onlyKeeper returns (uint256) {
        currentGameId++;
        uint256 gameId = currentGameId;
        
        Game storage newGame = games[gameId];
        newGame.gameId = gameId;
        newGame.state = GameState.REGISTRATION;
        newGame.gameKeeper = msg.sender;
        
        emit GameCreated(gameId, msg.sender);
        
        return gameId;
    }
    
    // Whitelisted player joins the game
    function joinGame(uint256 gameId) external {
        Game storage game = games[gameId];
        
        require(game.gameId == gameId, "Game does not exist");
        require(game.state == GameState.REGISTRATION, "Game is not in registration state");
        require(game.players.length < MAX_PLAYERS, "Game is full");
        require(playerCurrentGame[msg.sender] == 0, "Already in a game");
        require(whitelistedPlayers[msg.sender], "Player is not whitelisted");
        
        // Add player to the game
        game.players.push(msg.sender);
        game.playerInfo[msg.sender].isActive = true;
        game.playerInfo[msg.sender].chipBalance = INITIAL_CHIPS;
        game.playerInfo[msg.sender].hasFolded = false;
        game.playerInfo[msg.sender].lastActionTime = block.timestamp;
        
        playerCurrentGame[msg.sender] = gameId;
        
        emit PlayerJoined(gameId, msg.sender);
    }
    
    // Keeper starts the peek phase
    function startPeekPhase(uint256 gameId) external onlyKeeper {
        Game storage game = games[gameId];
        
        require(game.gameId == gameId, "Game does not exist");
        require(game.state == GameState.REGISTRATION, "Game is not in registration state");
        require(game.players.length >= 2, "Need at least 2 players");
        
        initializeDeck(gameId);
        
        dealCards(gameId);
        
        game.phaseStartTime = block.timestamp;
        game.phaseEndTime = block.timestamp + PEEK_PHASE_DURATION;
        
        // Move to peek phase
        game.state = GameState.PEEK_PHASE;
        
        // Emit event with both duration and end time to help the keeper
        emit PeekPhaseStarted(gameId, PEEK_PHASE_DURATION, game.phaseEndTime);
    }
    
    // Helper function to initialize the deck
    function initializeDeck(uint256 gameId) private {
        Game storage game = games[gameId];
        
        // Clear any existing cards
        delete game.deck;
        
        // Create a standard 52-card deck
        for (uint8 suit = 0; suit < 4; suit++) {
            for (uint8 value = 2; value <= 14; value++) {
                game.deck.push(Card(value, suit));
            }
        }
        
        // Simple shuffle using block.difficulty for randomness on TEN Network
        uint256 deckSize = game.deck.length;
        for (uint256 i = 0; i < deckSize; i++) {
            uint256 j = i + (block.difficulty % (deckSize - i));
            Card memory temp = game.deck[i];
            game.deck[i] = game.deck[j];
            game.deck[j] = temp;
        }
    }
    
    // Helper function to deal cards
    function dealCards(uint256 gameId) private {
        Game storage game = games[gameId];
        
        for (uint256 i = 0; i < game.players.length; i++) {
            address player = game.players[i];
            game.playerInfo[player].cardIdx = uint8(i);
        }
    }
    
    // Function for a player to peek at their card
    function peekAtCard(uint256 gameId) external {
        Game storage game = games[gameId];
        
        require(game.state == GameState.PEEK_PHASE, "Not in peek phase");
        require(block.timestamp < game.phaseEndTime, "Peek phase has ended");
        require(game.playerInfo[msg.sender].isActive, "Not an active player");
        require(!game.playerInfo[msg.sender].hasPeeked, "Already peeked");
        require(game.playerInfo[msg.sender].chipBalance >= PEEK_FEE, "Insufficient chips for peek fee");
        
        // Deduct the peek fee
        game.playerInfo[msg.sender].chipBalance -= PEEK_FEE;
        game.playerInfo[msg.sender].hasPeeked = true;
        game.playerInfo[msg.sender].lastActionTime = block.timestamp;
        
        // Get the player's card
        uint8 cardIdx = game.playerInfo[msg.sender].cardIdx;
        Card memory playerCard = game.deck[cardIdx];
        
        // Use a private event to notify the player of their card
        emit CardRevealed(msg.sender, playerCard.value, playerCard.suit);
        emit PlayerPeeked(gameId, msg.sender);
    }
    
    // Function to swap a card after peeking
    function swapCard(uint256 gameId) external {
        Game storage game = games[gameId];
        
        require(game.state == GameState.PEEK_PHASE, "Not in peek phase");
        require(block.timestamp < game.phaseEndTime, "Peek phase has ended");
        require(game.playerInfo[msg.sender].isActive, "Not an active player");
        require(game.playerInfo[msg.sender].hasPeeked, "Must peek before swapping");
        require(!game.playerInfo[msg.sender].hasSwapped, "Already swapped card");
        require(game.playerInfo[msg.sender].chipBalance >= SWAP_FEE, "Insufficient chips for swap fee");
        
        // Deduct the swap fee
        game.playerInfo[msg.sender].chipBalance -= SWAP_FEE;
        game.playerInfo[msg.sender].hasSwapped = true;
        game.playerInfo[msg.sender].lastActionTime = block.timestamp;
        
        // Get a new random card from deeper in the deck
        uint256 newPosition = game.players.length + 
                             game.playerInfo[msg.sender].cardIdx + 
                             (block.timestamp % (STANDARD_DECK_SIZE - game.players.length));
        
        // Ensure the position is within valid range
        newPosition = newPosition % STANDARD_DECK_SIZE;
        
        // Swap the cards in the deck
        uint8 oldCardIdx = game.playerInfo[msg.sender].cardIdx;
        uint8 newCardIdx = uint8(newPosition);
        
        // If we're about to take another player's card, get a different one
        for (uint256 i = 0; i < game.players.length; i++) {
            address player = game.players[i];
            if (game.playerInfo[player].cardIdx == newCardIdx) {
                // Found a conflict, move to the next available card
                newCardIdx = (newCardIdx + 1) % STANDARD_DECK_SIZE;
                i = 0; // Start over with the checks
            }
        }
        
        // Update the player's card index
        game.playerInfo[msg.sender].cardIdx = newCardIdx;
        
        // Player doesn't get to see the new card - they have to wait until showdown
        emit PlayerSwappedCard(gameId, msg.sender);
    }
    
    // Keeper ends peek phase and starts betting phase
    function endPeekPhase(uint256 gameId) external onlyKeeper {
        Game storage game = games[gameId];
        
        require(game.state == GameState.PEEK_PHASE, "Not in peek phase");
        require(block.timestamp >= game.phaseEndTime, "Peek phase time not up yet");
        
        // Start betting phase
        game.state = GameState.BETTING;
        game.phaseStartTime = block.timestamp;
        game.phaseEndTime = block.timestamp + BETTING_PHASE_DURATION;
        
        // Emit event with both duration and end time to help the keeper
        emit BettingPhaseStarted(gameId, BETTING_PHASE_DURATION, game.phaseEndTime);
    }
    
    // Function for players to place bets
    function placeBet(uint256 gameId, uint256 betAmount) external {
        Game storage game = games[gameId];
        
        require(game.state == GameState.BETTING, "Not in betting phase");
        require(block.timestamp < game.phaseEndTime, "Betting phase has ended");
        require(game.playerInfo[msg.sender].isActive, "Not an active player");
        require(!game.playerInfo[msg.sender].hasFolded, "Already folded");
        require(betAmount >= MINIMUM_BET, "Bet too small");
        
        // If there's already a bet in this round, we must match or raise
        if (game.currentBetAmount > 0) {
            uint256 requiredAmount = game.currentBetAmount - game.playerInfo[msg.sender].currentBet;
            require(betAmount >= requiredAmount, "Must at least call the current bet");
        }
        
        require(game.playerInfo[msg.sender].chipBalance >= betAmount, "Insufficient chips");
        
        // Place the bet
        game.playerInfo[msg.sender].chipBalance -= betAmount;
        game.playerInfo[msg.sender].currentBet += betAmount;
        game.potAmount += betAmount;
        game.playerInfo[msg.sender].lastActionTime = block.timestamp;
        
        // Update the current bet if this is a raise
        if (game.playerInfo[msg.sender].currentBet > game.currentBetAmount) {
            game.currentBetAmount = game.playerInfo[msg.sender].currentBet;
        }
        
        emit PlayerBet(gameId, msg.sender, betAmount);
    }
    
    // Function for players to fold
    function fold(uint256 gameId) external {
        Game storage game = games[gameId];
        
        require(game.state == GameState.BETTING, "Not in betting phase");
        require(block.timestamp < game.phaseEndTime, "Betting phase has ended");
        require(game.playerInfo[msg.sender].isActive, "Not an active player");
        require(!game.playerInfo[msg.sender].hasFolded, "Already folded");
        
        game.playerInfo[msg.sender].hasFolded = true;
        game.playerInfo[msg.sender].lastActionTime = block.timestamp;
        
        emit PlayerFolded(gameId, msg.sender);
        
        // Count active (non-folded) players
        uint256 activePlayers = 0;
        address lastActivePlayer;
        
        for (uint256 i = 0; i < game.players.length; i++) {
            address player = game.players[i];
            if (!game.playerInfo[player].hasFolded) {
                activePlayers++;
                lastActivePlayer = player;
            }
        }
        
        // If only one player remains, they win automatically
        if (activePlayers == 1) {
            _startShowdown(gameId);
            _awardPot(gameId, lastActivePlayer);
        }
    }
    
    // Keeper ends betting phase and moves to showdown
    function endBettingPhase(uint256 gameId) external onlyKeeper {
        Game storage game = games[gameId];
        
        require(game.state == GameState.BETTING, "Not in betting phase");
        require(block.timestamp >= game.phaseEndTime, "Betting phase time not up yet");
        
        _startShowdown(gameId);
    }
    
    // Start the showdown phase
    function _startShowdown(uint256 gameId) private {
        Game storage game = games[gameId];
        
        game.state = GameState.SHOWDOWN;
        
        emit ShowdownStarted(gameId);
        
        // Determine winner during showdown
        determineWinner(gameId);
    }
    
    // Determine the winner at showdown
    function determineWinner(uint256 gameId) private {
        Game storage game = games[gameId];
        
        // Find highest card among non-folded players
        address winner;
        uint8 highestValue = 0;
        uint8 highestSuit = 0;
        
        for (uint256 i = 0; i < game.players.length; i++) {
            address player = game.players[i];
            
            // Skip folded players
            if (game.playerInfo[player].hasFolded) continue;
            
            uint8 cardIdx = game.playerInfo[player].cardIdx;
            Card memory playerCard = game.deck[cardIdx];
            
            // Check if this card is higher
            if (playerCard.value > highestValue || 
                (playerCard.value == highestValue && playerCard.suit > highestSuit)) {
                highestValue = playerCard.value;
                highestSuit = playerCard.suit;
                winner = player;
            }
            
            // Reveal cards to all players for transparency
            emit CardRevealed(player, playerCard.value, playerCard.suit);
        }
        
        // Award pot to the winner
        _awardPot(gameId, winner);
    }
    
    // Award the pot to the winner
    function _awardPot(uint256 gameId, address winner) private {
        Game storage game = games[gameId];
        
        // Award chips to the winner
        game.playerInfo[winner].chipBalance += game.potAmount;
        
        // Move game to ended state
        game.state = GameState.ENDED;
        
        uint256 potAmount = game.potAmount;
        emit GameEnded(gameId, winner, potAmount);
        
        // Reset game state for cleanup
        game.potAmount = 0;
        game.currentBetAmount = 0;
    }
    
    // Check if all players have matched the current bet - for keeper service
    function checkAllPlayersMatched(uint256 gameId) external view returns (bool) {
        Game storage game = games[gameId];
        
        if (game.state != GameState.BETTING) {
            return false;
        }
        
        // Check if all players have matched or folded
        for (uint256 i = 0; i < game.players.length; i++) {
            address player = game.players[i];
            
            // Skip folded players
            if (game.playerInfo[player].hasFolded) continue;
            
            // Check if player has matched current bet
            if (game.playerInfo[player].currentBet < game.currentBetAmount) {
                return false;
            }
        }
        
        return true;
    }
    
    // Check how many players remain active - for keeper service
    function getActivePlayerCount(uint256 gameId) external view returns (uint256 count) {
        Game storage game = games[gameId];
        
        for (uint256 i = 0; i < game.players.length; i++) {
            if (!game.playerInfo[game.players[i]].hasFolded) {
                count++;
            }
        }
        
        return count;
    }
    
    // Get the phase timing information - for keeper service
    function getPhaseTimingInfo(uint256 gameId) external view returns (
        GameState state,
        uint256 startTime,
        uint256 endTime, 
        uint256 timeRemaining,
        bool isExpired
    ) {
        Game storage game = games[gameId];
        
        if (game.state == GameState.REGISTRATION || game.state == GameState.ENDED) {
            return (game.state, 0, 0, 0, false);
        }
        
        uint256 remaining = 0;
        bool expired = false;
        
        if (block.timestamp < game.phaseEndTime) {
            remaining = game.phaseEndTime - block.timestamp;
            expired = false;
        } else {
            remaining = 0;
            expired = true;
        }
        
        return (game.state, game.phaseStartTime, game.phaseEndTime, remaining, expired);
    }
    
    // Function for checking chip balance
    function getChipBalance(uint256 gameId, address player) external view returns (uint256) {
        return games[gameId].playerInfo[player].chipBalance;
    }
    
    // Function to check if a player has peeked at their card
    function hasPlayerPeeked(uint256 gameId, address player) external view returns (bool) {
        return games[gameId].playerInfo[player].hasPeeked;
    }
    
    // Function to check if a player has swapped their card
    function hasPlayerSwapped(uint256 gameId, address player) external view returns (bool) {
        return games[gameId].playerInfo[player].hasSwapped;
    }
    
    // Function to clean up after a game
    function cleanup(uint256 gameId) external onlyKeeper {
        Game storage game = games[gameId];
        
        require(game.state == GameState.ENDED, "Game not ended");
        
        // Clear the player's current game tracking
        for (uint256 i = 0; i < game.players.length; i++) {
            address player = game.players[i];
            playerCurrentGame[player] = 0;
        }
    }
    
    // View functions for game state
    function getGameState(uint256 gameId) external view returns (
        GameState state,
        uint256 potAmount,
        uint256 currentBet,
        uint256 playerCount,
        address[] memory playerAddresses,
        uint256 phaseEndTime
    ) {
        Game storage game = games[gameId];
        
        return (
            game.state,
            game.potAmount,
            game.currentBetAmount,
            game.players.length,
            game.players,
            game.phaseEndTime
        );
    }
    
    // Get complete player state for any player
    function getPlayerState(uint256 gameId, address player) external view returns (
        bool isActive,
        bool hasPeeked,
        bool hasSwapped,
        uint256 chipBalance,
        uint256 currentBet,
        bool hasFolded,
        uint256 lastActionTime
    ) {
        Game storage game = games[gameId];
        
        return (
            game.playerInfo[player].isActive,
            game.playerInfo[player].hasPeeked,
            game.playerInfo[player].hasSwapped,
            game.playerInfo[player].chipBalance,
            game.playerInfo[player].currentBet,
            game.playerInfo[player].hasFolded,
            game.playerInfo[player].lastActionTime
        );
    }
    
    // Get all player active statuses in a single call
    function getActivePlayers(uint256 gameId) external view returns (address[] memory activePlayers) {
        Game storage game = games[gameId];
        uint256 count = 0;
        
        // Count active players
        for (uint256 i = 0; i < game.players.length; i++) {
            if (!game.playerInfo[game.players[i]].hasFolded) {
                count++;
            }
        }
        
        // Create result array
        activePlayers = new address[](count);
        uint256 index = 0;
        
        // Fill active players
        for (uint256 i = 0; i < game.players.length; i++) {
            address player = game.players[i];
            if (!game.playerInfo[player].hasFolded) {
                activePlayers[index] = player;
                index++;
            }
        }
    }
    
    // Function for a player to leave the game if it hasn't started
    function leaveGame(uint256 gameId) external {
        Game storage game = games[gameId];
        
        require(game.playerInfo[msg.sender].isActive, "Not in this game");
        require(game.state == GameState.REGISTRATION, "Game has already started");
        
        // Find and remove the player
        for (uint256 i = 0; i < game.players.length; i++) {
            if (game.players[i] == msg.sender) {
                // Replace this player with the last player in the array
                game.players[i] = game.players[game.players.length - 1];
                game.players.pop();
                break;
            }
        }
        
        // Clear player data
        delete game.playerInfo[msg.sender];
        playerCurrentGame[msg.sender] = 0;
    }
}