// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./PokerCardLibrary.sol";
import "./PokerGameLibrary.sol";

interface ISpectatorBetting {
    function openBetting(uint256 gameId) external;
    function closeBetting(uint256 gameId) external;
    function processResults(uint256 gameId, address winner) external;
}

contract OneCard {
    using CardLibrary for CardLibrary.Card[];
    using GameLibrary for uint256;
    
    // Simple ownership - contract deployer is the fixed owner/admin
    address private immutable _owner;

    address public spectatorBettingContract;
    
    // Game constants
    uint8 private constant STANDARD_DECK_SIZE = 52; // Match the constant in CardLibrary
    uint8 private constant MAX_PLAYERS = 5; // Maximum 5 players per game
    uint256 private constant INITIAL_CHIPS = 25;    
    uint256 private constant PEEK_FEE = 5;
    uint256 private constant SWAP_FEE = 7;         
    uint256 private constant MINIMUM_BET = 1;
    
    // Timer constants
    uint256 private constant PEEK_PHASE_DURATION = 2 minutes;
    uint256 private constant BETTING_PHASE_DURATION = 5 minutes;
    // NEW: Buffer periods between phases
    uint256 private constant PHASE_TRANSITION_BUFFER = 30 seconds;

    // Whitelist tracking - with efficient array access
    mapping(address => bool) public whitelistedPlayers;
    address[] public whitelistedPlayersList;
    
    // Player state - optimized packing (booleans together)
    struct Player {
        // Pack these booleans into a single storage slot
        bool isActive;
        bool hasPeeked;
        bool hasSwappedCard;
        bool hasFolded;
        // These fit in another slot
        uint8 cardIdx;
        uint256 chipBalance;
        uint256 currentBet;
        uint256 lastActionTime;
        // NEW: Action nonce for betting operations
        uint256 actionNonce;
        // AI agent rationalization for decision making
        string lastActionRational;
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
        address gameKeeper;
        uint256 phaseEndTime; // Removed phaseStartTime to save storage
        // NEW: Added buffer period end time
        uint256 bufferEndTime;
        // NEW: Version tracking for game state
        uint256 stateVersion;
        // NEW: Cleanup safeguard
        bool isCleanedUp;
    }
    
    // Game tracking
    uint256 public currentGameId;
    mapping(uint256 => Game) private games;
    mapping(address => uint256) public playerCurrentGame;
    uint256[] public activeGames; // Array to track active games for spectating
    
    // Service keeper addresses
    mapping(address => bool) private authorizedKeepers;
    
    // Events - streamlined
    event GameCreated(uint256 indexed gameId, address keeper);
    event PlayerJoined(uint256 indexed gameId, address player);
    event PeekPhaseStarted(uint256 indexed gameId);
    event BufferPeriodStarted(uint256 indexed gameId, GameLibrary.GameState currentState, GameLibrary.GameState nextState);
    event BettingPhaseStarted(uint256 indexed gameId);
    
    // Public event for action type (without details) - visible to all
    event PlayerActionType(uint256 indexed gameId, address player, string actionType);
    
    // Private event for detailed action (only visible to the player)
    event PlayerActionDetails(uint256 indexed gameId, address indexed player, string action, uint256 amount, uint256 nonce, string rational);
    
    event ShowdownStarted(uint256 indexed gameId);
    event GameEnded(uint256 indexed gameId, address winner, uint256 potAmount);
    
    event PlayersWhitelisted(address[] players);
    event PlayersRemovedFromWhitelist(address[] players);
    
    // Private notifications for cards (only visible to the player)
    event CardPeeked(address indexed player, uint8 value, uint8 suit);
    
    // Event for card swap - reduced information, just notification that a swap happened
    event CardSwapped(address indexed player, uint8 oldValue, uint8 oldSuit);
    
    // Private confirmation for betting actions
    event BettingConfirmation(address indexed player, string action, uint256 amount);
    
    // Events for spectating
    event GameSpectatable(uint256 indexed gameId, GameLibrary.GameState state, uint256 playerCount);
    event GameNoLongerSpectatable(uint256 indexed gameId);
    event GameStateUpdated(uint256 indexed gameId, GameLibrary.GameState state, uint256 potAmount, uint256 currentBet, uint256 stateVersion);
    
    constructor() {
        _owner = msg.sender;
        authorizedKeepers[msg.sender] = true;
        
        // Add owner to whitelist
        whitelistedPlayers[msg.sender] = true;
        whitelistedPlayersList.push(msg.sender);
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
    
    // NEW: Check that game is not in buffer period
    modifier notInBufferPeriod(uint256 gameId) {
        require(block.timestamp >= games[gameId].bufferEndTime, "In buffer period");
        _;
    }
    
    // NEW: Check that a game hasn't been cleaned up
    modifier notCleanedUp(uint256 gameId) {
        require(!games[gameId].isCleanedUp, "Game already cleaned up");
        _;
    }
    
    function owner() public view returns (address) {
        return _owner;
    }

    // Function to set the SpectatorBetting contract address (only owner can call)
    function setSpectatorBettingContract(address _spectatorBettingContract) external onlyOwner {
        spectatorBettingContract = _spectatorBettingContract;
    }
    
    // Whitelist management - with efficient array operations
    function addMultipleToWhitelist(address[] calldata players) external onlyOwner {
        for (uint256 i = 0; i < players.length; i++) {
            if (!whitelistedPlayers[players[i]]) {
                whitelistedPlayers[players[i]] = true;
                whitelistedPlayersList.push(players[i]);
            }
        }
        emit PlayersWhitelisted(players);
    }
    
    function removeMultipleFromWhitelist(address[] calldata players) external onlyOwner {
        for (uint256 i = 0; i < players.length; i++) {
            if (whitelistedPlayers[players[i]]) {
                whitelistedPlayers[players[i]] = false;
                // No need to remove from array since we check mapping when using array
            }
        }
        emit PlayersRemovedFromWhitelist(players);
    }
    
    // Remove redundant getter since mapping is now public
    // function isWhitelisted(address player) public view returns (bool) {
    //     return whitelistedPlayers[player];
    // }
    
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
    
    // Removed bitmap operations for revealed cards
    
    // NEW: Update game state version
    function _incrementStateVersion(uint256 gameId) private {
        unchecked { games[gameId].stateVersion++; }
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
    
    // Game creation - automatically adds all whitelisted players
    function createGame() external onlyKeeper returns (uint256) {
        unchecked { currentGameId++; }
        uint256 gameId = currentGameId;
        
        Game storage newGame = games[gameId];
        newGame.gameId = gameId;
        newGame.state = GameLibrary.GameState.REGISTRATION;
        newGame.gameKeeper = msg.sender;
        newGame.activePlayerCount = 0;
        newGame.stateVersion = 1; // Initialize version
        newGame.isCleanedUp = false; // Game is not cleaned up
        
        // Add this game to the active games list for spectating
        activeGames.push(gameId);
        
        emit GameCreated(gameId, msg.sender);
        emit GameSpectatable(gameId, GameLibrary.GameState.REGISTRATION, 0);

        // Open betting in the SpectatorBetting contract if it's set
        if (spectatorBettingContract != address(0)) {
            try ISpectatorBetting(spectatorBettingContract).openBetting(gameId) {
                // Betting opened successfully
            } catch {
                // Betting failed to open, but we continue with the game
            }
        }
        
        // Auto-add whitelisted players to the game - efficient for 5 players
        for (uint256 i = 0; i < whitelistedPlayersList.length && i < MAX_PLAYERS; i++) {
            address player = whitelistedPlayersList[i];
            // Check if player is still whitelisted and not in a game
            if (whitelistedPlayers[player] && playerCurrentGame[player] == 0) {
                _addPlayerToGame(gameId, player);
                if (newGame.players.length >= MAX_PLAYERS) {
                    break;
                }
            }
        }
        
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
        playerData.actionNonce = 0; // Initialize action nonce
        
        // Track which game the player is in
        playerCurrentGame[player] = gameId;
        
        // Increment active player count
        unchecked { game.activePlayerCount++; }
        
        emit PlayerJoined(gameId, player);
    }
    
    // Any player can join the game (no whitelist requirement)
    function joinGame(uint256 gameId) external gameExists(gameId) notCleanedUp(gameId) {
        Game storage game = games[gameId];
        
        require(game.state == GameLibrary.GameState.REGISTRATION, "Not registration state");
        require(game.players.length < MAX_PLAYERS, "Game full");
        require(playerCurrentGame[msg.sender] == 0, "Already in a game");
        
        // Add player to game
        game.players.push(msg.sender);
        Player storage playerData = game.playerInfo[msg.sender];
        playerData.isActive = true;
        playerData.chipBalance = INITIAL_CHIPS;
        playerData.lastActionTime = block.timestamp;
        playerData.actionNonce = 0; // Initialize action nonce
        
        // Track which game the player is in
        playerCurrentGame[msg.sender] = gameId;
        
        // Increment active player count
        unchecked { game.activePlayerCount++; }
        
        emit PlayerJoined(gameId, msg.sender);
    }
    
    // Authorized keepers can add players directly
    function addPlayerToGame(uint256 gameId, address player) external onlyKeeper gameExists(gameId) notCleanedUp(gameId) {
        Game storage game = games[gameId];
        
        require(game.state == GameLibrary.GameState.REGISTRATION, "Not registration state");
        require(game.players.length < MAX_PLAYERS, "Game full");
        require(playerCurrentGame[player] == 0, "Player already in a game");
        
        // Add player to game
        game.players.push(player);
        Player storage playerData = game.playerInfo[player];
        playerData.isActive = true;
        playerData.chipBalance = INITIAL_CHIPS;
        playerData.lastActionTime = block.timestamp;
        playerData.actionNonce = 0; // Initialize action nonce
        
        // Track which game the player is in
        playerCurrentGame[player] = gameId;
        
        // Increment active player count
        unchecked { game.activePlayerCount++; }
        
        emit PlayerJoined(gameId, player);
    }
    
    // Keeper starts the peek phase
    function startPeekPhase(uint256 gameId) external onlyKeeper gameExists(gameId) notCleanedUp(gameId) {
        Game storage game = games[gameId];
        
        require(game.state == GameLibrary.GameState.REGISTRATION, "Not registration state");
        require(game.players.length >= 2, "Need 2+ players");

        // Close betting in the SpectatorBetting contract if it's set
        if (spectatorBettingContract != address(0)) {
            try ISpectatorBetting(spectatorBettingContract).closeBetting(gameId) {
                // Betting closed successfully
            } catch {
                // Betting failed to close, but we continue with the game
            }
        }
        
        // Start buffer period before peek phase
        game.bufferEndTime = block.timestamp + PHASE_TRANSITION_BUFFER;
        
        // Set timeframe for the peek phase
        game.phaseEndTime = game.bufferEndTime + PEEK_PHASE_DURATION;
        
        // Move to peek phase
        game.state = GameLibrary.GameState.PEEK_PHASE;
        
        // Initialize and shuffle the deck using Fisher-Yates algorithm
        _initializeDeck(gameId);
        
        // Deal cards to players
        _dealCards(gameId);
        
        // Update state version
        _incrementStateVersion(gameId);
        
        // Emit buffer period start event
        emit BufferPeriodStarted(gameId, GameLibrary.GameState.REGISTRATION, GameLibrary.GameState.PEEK_PHASE);
        
        // Emit state update
        emit GameStateUpdated(gameId, GameLibrary.GameState.PEEK_PHASE, game.potAmount, game.currentBetAmount, game.stateVersion);
        
        // Client will calculate actual start time = game.bufferEndTime
        emit PeekPhaseStarted(gameId);
    }
    
    // Helper function to initialize the deck with Fisher-Yates shuffle using prevrandao
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
        }
    }
    
    // Function for a player to peek at their card
    function peekAtCard(uint256 gameId, string calldata rational) external gameExists(gameId) activePlayer(gameId) notInBufferPeriod(gameId) notCleanedUp(gameId) {
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
        
        // Store the rationalization
        player.lastActionRational = rational;
        
        // Get the player's card
        uint8 cardIdx = player.cardIdx;
        CardLibrary.Card memory playerCard = game.deck[cardIdx];
        
        // Use a private event to notify the player of their card
        emit CardPeeked(msg.sender, playerCard.value, playerCard.suit);
        
        // Public event that just shows action type (visible to all)
        emit PlayerActionType(gameId, msg.sender, "peek");
        
        // Private detailed event (only visible to the player)
        emit PlayerActionDetails(gameId, msg.sender, "peek", PEEK_FEE, player.actionNonce, rational);
    }
    
    // Function to swap card - only available if player has peeked
    // Split into two functions to avoid stack too deep errors
    function swapCard(uint256 gameId, string calldata rational) external gameExists(gameId) activePlayer(gameId) notInBufferPeriod(gameId) notCleanedUp(gameId) {
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
        player.lastActionRational = rational;
        
        // Execute the swap
        _executeCardSwap(gameId, player);
        
        // Public event that just shows action type (visible to all)
        emit PlayerActionType(gameId, msg.sender, "swap");
        
        // Private detailed event (only visible to the player)
        emit PlayerActionDetails(gameId, msg.sender, "swap", SWAP_FEE, player.actionNonce, rational);
    }
    
    // Helper function to perform the card swap - breaks up the logic to avoid stack too deep
    function _executeCardSwap(uint256 gameId, Player storage player) private {
        Game storage game = games[gameId];
        
        // Get current card info before swapping
        uint8 currentCardIdx = player.cardIdx;
        CardLibrary.Card memory currentCard = game.deck[currentCardIdx];
        
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
        
        // Get the new card info
        CardLibrary.Card memory newCard = game.deck[newCardIdx];
        
        // Emit the swap result with only old card details (public)
        emit CardSwapped(
            msg.sender, 
            currentCard.value, 
            currentCard.suit
        );
        
        // Privately reveal the new card to the player
        emit CardPeeked(msg.sender, newCard.value, newCard.suit);
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
        
        // Start buffer period before betting phase
        game.bufferEndTime = block.timestamp + PHASE_TRANSITION_BUFFER;
        
        // Set betting phase end time after buffer
        game.phaseEndTime = game.bufferEndTime + BETTING_PHASE_DURATION;
        
        // Start betting phase
        game.state = GameLibrary.GameState.BETTING;
        
        // Update state version
        _incrementStateVersion(gameId);
        
        // Emit buffer period start event
        emit BufferPeriodStarted(gameId, GameLibrary.GameState.PEEK_PHASE, GameLibrary.GameState.BETTING);
        
        // Emit state update
        emit GameStateUpdated(gameId, GameLibrary.GameState.BETTING, game.potAmount, game.currentBetAmount, game.stateVersion);
        
        // Client will calculate actual start time = game.bufferEndTime
        emit BettingPhaseStarted(gameId);
    }
    
    // Function for players to place bets
    function placeBet(uint256 gameId, uint256 betAmount, string calldata rational) external gameExists(gameId) activePlayer(gameId) notInBufferPeriod(gameId) notCleanedUp(gameId) {
        Game storage game = games[gameId];
        Player storage player = game.playerInfo[msg.sender];
        
        require(game.state == GameLibrary.GameState.BETTING, "Not betting phase");
        require(block.timestamp < game.phaseEndTime, "Betting phase ended");
        require(!player.hasFolded, "Already folded");
        require(betAmount >= MINIMUM_BET, "Bet too small");
        
        // If there's already a bet in this round, we must match or raise
        if (game.currentBetAmount > 0) {
            uint256 requiredAmount = game.currentBetAmount - player.currentBet;
            require(betAmount >= requiredAmount, "Must match current bet");
        }
        
        require(player.chipBalance >= betAmount, "Insufficient chips");
        
        // Increment action nonce
        unchecked { player.actionNonce++; }
        
        // Store the rationalization
        player.lastActionRational = rational;
        
        // Place the bet
        unchecked {
            player.chipBalance -= betAmount;
            player.currentBet += betAmount;
            game.potAmount += betAmount;
        }
        player.lastActionTime = block.timestamp;
        
        // Update the current bet if this is a raise
        if (player.currentBet > game.currentBetAmount) {
            game.currentBetAmount = player.currentBet;
        }
        
        // Public event for action type (no details)
        emit PlayerActionType(gameId, msg.sender, "bet");
        
        // Private confirmation of bet amount
        emit BettingConfirmation(msg.sender, "bet", betAmount);
        
        // Private detailed event (only visible to the player)
        emit PlayerActionDetails(gameId, msg.sender, "bet", betAmount, player.actionNonce, rational);
        
        // Update spectators with game state (but not bet details)
        emit GameStateUpdated(gameId, game.state, game.potAmount, game.currentBetAmount, game.stateVersion);
    }
    
    // Function for players to fold
    function fold(uint256 gameId, string calldata rational) external gameExists(gameId) activePlayer(gameId) notInBufferPeriod(gameId) notCleanedUp(gameId) {
        Game storage game = games[gameId];
        Player storage player = game.playerInfo[msg.sender];
        
        require(game.state == GameLibrary.GameState.BETTING, "Not betting phase");
        require(block.timestamp < game.phaseEndTime, "Betting phase ended");
        require(!player.hasFolded, "Already folded");
        
        // Increment action nonce
        unchecked { player.actionNonce++; }
        
        // Store the rationalization
        player.lastActionRational = rational;
        
        player.hasFolded = true;
        player.lastActionTime = block.timestamp;
        
        // Update active player count
        unchecked { game.activePlayerCount--; }
        
        // Public event for action type (no details)
        emit PlayerActionType(gameId, msg.sender, "fold");
        
        // Private confirmation of fold
        emit BettingConfirmation(msg.sender, "fold", 0);
        
        // Private detailed event (only visible to the player)
        emit PlayerActionDetails(gameId, msg.sender, "fold", 0, player.actionNonce, rational);
        
        // Update spectators with game state (but not all details)
        emit GameStateUpdated(gameId, game.state, game.potAmount, game.currentBetAmount, game.stateVersion);
        
        // Check if only one player remains
        if (game.activePlayerCount == 1) {
            address lastActivePlayer = _findLastActivePlayer(gameId);
            _startShowdown(gameId);
            _awardPot(gameId, lastActivePlayer);
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
        
        // Update state version
        _incrementStateVersion(gameId);
        
        emit ShowdownStarted(gameId);
        emit GameStateUpdated(gameId, GameLibrary.GameState.SHOWDOWN, game.potAmount, game.currentBetAmount, game.stateVersion);
        
        // Determine winner during showdown
        _determineWinner(gameId);
    }
    
    // Determine the winner at showdown
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
        
        // Award pot to the winner
        _awardPot(gameId, winner);
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
    
    // Award the pot to the winner
    function _awardPot(uint256 gameId, address winner) private {
        Game storage game = games[gameId];
        
        // Award chips to the winner
        unchecked { game.playerInfo[winner].chipBalance += game.potAmount; }
        
        // Move game to ended state
        game.state = GameLibrary.GameState.ENDED;
        
        // Update state version
        _incrementStateVersion(gameId);
        
        uint256 potAmount = game.potAmount;
        emit GameEnded(gameId, winner, potAmount);
        emit GameStateUpdated(gameId, GameLibrary.GameState.ENDED, potAmount, game.currentBetAmount, game.stateVersion);
        
        // Process results in the SpectatorBetting contract if it's set
        if (spectatorBettingContract != address(0)) {
            try ISpectatorBetting(spectatorBettingContract).processResults(gameId, winner) {
                // Results processed successfully
            } catch {
                // Results processing failed, but we continue with the game
            }
        }

        // Reset game state for cleanup
        game.potAmount = 0;
        game.currentBetAmount = 0;
    }
    
    // Check if all players have matched the current bet - for keeper service
    function checkAllPlayersMatched(uint256 gameId) external view gameExists(gameId) returns (bool) {
        Game storage game = games[gameId];
        
        if (game.state != GameLibrary.GameState.BETTING) {
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
    
    // Get active player count using the cached value
    function getActivePlayerCount(uint256 gameId) external view gameExists(gameId) returns (uint256) {
        return games[gameId].activePlayerCount;
    }
    
    // Combined function to get all game and phase information in a single call
    function getGameInfo(uint256 gameId) external view gameExists(gameId) returns (
        GameLibrary.GameState state,
        uint256 potAmount,
        uint256 currentBet,
        uint256 phaseEndTime,
        uint256 bufferEndTime,
        uint256 remainingTime,
        uint256 playerCount,
        uint256 activeCount,
        address gameKeeper,
        uint256 stateVersion,
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
            game.bufferEndTime,
            remaining,
            game.players.length,
            game.activePlayerCount,
            game.gameKeeper,
            game.stateVersion,
            game.isCleanedUp
        );
    }
    
    // Get player information - combined to reduce gas costs for frontend
    function getPlayerInfo(uint256 gameId, address player) external view gameExists(gameId) returns (
        bool isActive,
        bool hasPeeked,
        bool hasSwappedCard,
        bool hasFolded,
        uint256 chipBalance,
        uint256 currentBet,
        uint256 lastActionTime,
        uint256 actionNonce,
        string memory lastActionRational
    ) {
        Game storage game = games[gameId];
        Player storage playerData = game.playerInfo[player];
        
        return (
            playerData.isActive,
            playerData.hasPeeked,
            playerData.hasSwappedCard,
            playerData.hasFolded,
            playerData.chipBalance,
            playerData.currentBet,
            playerData.lastActionTime,
            playerData.actionNonce,
            playerData.lastActionRational
        );
    }
    
    // Get all players in a single call
    function getPlayers(uint256 gameId) external view gameExists(gameId) returns (
        address[] memory players
    ) {
        return games[gameId].players;
    }
    
    // Get all active players in a single call - using cached count for efficiency
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
    
    // Remove redundant getter since activeGames is now public
    // function getActiveGames() external view returns (uint256[] memory) {
    //     return activeGames;
    // }
    
    // Get all cards for spectating during SHOWDOWN or ENDED phases
    function getRevealedCardsForSpectating(uint256 gameId) external view gameExists(gameId) returns (
        address[] memory playerAddresses,
        uint8[] memory cardValues,
        uint8[] memory cardSuits
    ) {
        Game storage game = games[gameId];
        
        // Only allow viewing cards during showdown or when game is ended
        require(game.state == GameLibrary.GameState.SHOWDOWN || game.state == GameLibrary.GameState.ENDED, "Cards not yet revealed");
        
        playerAddresses = new address[](game.players.length);
        cardValues = new uint8[](game.players.length);
        cardSuits = new uint8[](game.players.length);
        
        for (uint256 i = 0; i < game.players.length; i++) {
            address player = game.players[i];
            
            // Skip folded players
            if (game.playerInfo[player].hasFolded) {
                playerAddresses[i] = player;
                cardValues[i] = 0; // 0 indicates folded
                cardSuits[i] = 0;
                continue;
            }
            
            uint8 cardIdx = game.playerInfo[player].cardIdx;
            CardLibrary.Card memory playerCard = game.deck[cardIdx];
            
            playerAddresses[i] = player;
            cardValues[i] = playerCard.value;
            cardSuits[i] = playerCard.suit;
        }
        
        return (playerAddresses, cardValues, cardSuits);
    }
    
    // Get basic game information for spectating
    function getGameBasicInfo(uint256 gameId) external view gameExists(gameId) returns (
        GameLibrary.GameState state,
        uint256 potAmount,
        uint256 currentBet,
        uint256 phaseEndTime,
        uint256 bufferEndTime,
        uint256 playerCount,
        uint256 activeCount,
        uint256 stateVersion,
        bool isCleanedUp
    ) {
        Game storage game = games[gameId];
        
        return (
            game.state,
            game.potAmount,
            game.currentBetAmount,
            game.phaseEndTime,
            game.bufferEndTime,
            game.players.length,
            game.activePlayerCount,
            game.stateVersion,
            game.isCleanedUp
        );
    }
    
    // Get player details for spectating - separate function to avoid stack too deep
    function getPlayersForSpectating(uint256 gameId) external view gameExists(gameId) returns (
        address[] memory playerAddresses,
        bool[] memory playerActiveBits,
        bool[] memory playerFoldedBits,
        uint256[] memory playerChipBalances,
        uint256[] memory playerCurrentBets,
        uint256[] memory playerActionNonces,
        string[] memory playerLastActionRationals
    ) {
        Game storage game = games[gameId];
        uint256 playerCount = game.players.length;
        
        // Get player addresses
        playerAddresses = game.players;
        
        // Initialize player detail arrays
        playerActiveBits = new bool[](playerCount);
        playerFoldedBits = new bool[](playerCount);
        playerChipBalances = new uint256[](playerCount);
        playerCurrentBets = new uint256[](playerCount);
        playerActionNonces = new uint256[](playerCount);
        playerLastActionRationals = new string[](playerCount);
        
        // Fill player details
        for (uint256 i = 0; i < playerCount; i++) {
            address player = playerAddresses[i];
            Player storage playerData = game.playerInfo[player];
            
            playerActiveBits[i] = playerData.isActive;
            playerFoldedBits[i] = playerData.hasFolded;
            playerChipBalances[i] = playerData.chipBalance;
            playerCurrentBets[i] = playerData.currentBet;
            playerActionNonces[i] = playerData.actionNonce;
            playerLastActionRationals[i] = playerData.lastActionRational;
        }
        
        return (
            playerAddresses,
            playerActiveBits,
            playerFoldedBits,
            playerChipBalances,
            playerCurrentBets,
            playerActionNonces,
            playerLastActionRationals
        );
    }
    
    // Function for a player to leave the game if it hasn't started
    function leaveGame(uint256 gameId, string calldata rational) external gameExists(gameId) notCleanedUp(gameId) {
        Game storage game = games[gameId];
        
        require(game.playerInfo[msg.sender].isActive, "Not in this game");
        require(game.state == GameLibrary.GameState.REGISTRATION, "Game already started");
        
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
        
        // Public event for action type (no details)
        emit PlayerActionType(gameId, msg.sender, "leave");
        
        // Private detailed event (only visible to the player)
        emit PlayerActionDetails(gameId, msg.sender, "leave", 0, 0, rational);
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
        
        // Update state version
        _incrementStateVersion(gameId);
        
        // Remove from activeGames list
        _removeFromActiveGames(gameId);
        emit GameNoLongerSpectatable(gameId);
        emit GameStateUpdated(gameId, game.state, game.potAmount, game.currentBetAmount, game.stateVersion);
    }
    
    // Helper function to remove a game from the activeGames array
    function _removeFromActiveGames(uint256 gameId) private {
        for (uint256 i = 0; i < activeGames.length; i++) {
            if (activeGames[i] == gameId) {
                // Replace with the last element and pop
                activeGames[i] = activeGames[activeGames.length - 1];
                activeGames.pop();
                break;
            }
        }
    }
}