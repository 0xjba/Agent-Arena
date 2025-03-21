// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract HiddenOneCardPoker {
    // Simple ownership - contract deployer is the fixed owner/admin
    address private immutable _owner;
    
    // Game constants
    uint8 private constant STANDARD_DECK_SIZE = 52;
    uint8 private constant MAX_PLAYERS = 5; // Maximum 5 players per game
    uint256 private constant INITIAL_CHIPS = 20;    
    uint256 private constant PEEK_FEE = 3;
    uint256 private constant SWAP_FEE = 5;         
    uint256 private constant MINIMUM_BET = 1;
    
    // Timer constants
    uint256 private constant PEEK_PHASE_DURATION = 2 minutes;
    uint256 private constant BETTING_PHASE_DURATION = 5 minutes;

    // Whitelist tracking - with efficient array access
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
    
    // Player state - optimized packing (booleans together)
    struct Player {
        // Pack these booleans into a single storage slot
        bool isActive;
        bool hasPeeked;
        bool hasSwapped;
        bool hasFolded;
        // These fit in another slot
        uint8 cardIdx;
        uint256 chipBalance;
        uint256 currentBet;
        uint256 lastActionTime;
    }
    
    // Game structure - optimized to reduce storage usage
    struct Game {
        uint256 gameId;
        GameState state;
        address[] players;
        uint256 activePlayerCount; // Track active players to avoid recomputation
        mapping(address => Player) playerInfo;
        Card[] deck;
        // Card assignment tracking - using a bitmap
        uint256 cardAssignmentBitmap; // Uses a single storage slot for all 52 cards
        uint256 potAmount;
        uint256 currentBetAmount;
        address gameKeeper;
        uint256 phaseEndTime; // Removed phaseStartTime to save storage
    }
    
    // Game tracking
    uint256 private currentGameId;
    mapping(uint256 => Game) private games;
    mapping(address => uint256) private playerCurrentGame;
    
    // Service keeper addresses
    mapping(address => bool) private authorizedKeepers;
    
    // Events - streamlined
    event GameCreated(uint256 indexed gameId, address keeper);
    event PlayerJoined(uint256 indexed gameId, address indexed player);
    event PeekPhaseStarted(uint256 indexed gameId);
    event BettingPhaseStarted(uint256 indexed gameId);
    event PlayerAction(uint256 indexed gameId, address indexed player, string action, uint256 amount);
    event ShowdownStarted(uint256 indexed gameId);
    event GameEnded(uint256 indexed gameId, address indexed winner, uint256 potAmount);
    
    event PlayersWhitelisted(address[] players);
    event PlayersRemovedFromWhitelist(address[] players);
    
    // Private notifications for cards (only visible to the player)
    event CardRevealed(address indexed player, uint8 value, uint8 suit);
    
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
    
    function owner() public view returns (address) {
        return _owner;
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
    
    function isWhitelisted(address player) public view returns (bool) {
        return whitelistedPlayers[player];
    }
    
    // Bitmap operations for card assignments
    function _isCardAssigned(uint256 gameId, uint8 cardIdx) private view returns (bool) {
        return (games[gameId].cardAssignmentBitmap & (1 << cardIdx)) != 0;
    }
    
    function _assignCard(uint256 gameId, uint8 cardIdx) private {
        games[gameId].cardAssignmentBitmap |= (1 << cardIdx);
    }
    
    function _unassignCard(uint256 gameId, uint8 cardIdx) private {
        games[gameId].cardAssignmentBitmap &= ~(1 << cardIdx);
    }
    
    function _clearCardAssignments(uint256 gameId) private {
        games[gameId].cardAssignmentBitmap = 0;
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
        newGame.state = GameState.REGISTRATION;
        newGame.gameKeeper = msg.sender;
        newGame.activePlayerCount = 0;
        
        emit GameCreated(gameId, msg.sender);
        
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
        
        // Track which game the player is in
        playerCurrentGame[player] = gameId;
        
        // Increment active player count
        unchecked { game.activePlayerCount++; }
        
        emit PlayerJoined(gameId, player);
    }
    
    // Any player can join the game (no whitelist requirement)
    function joinGame(uint256 gameId) external gameExists(gameId) {
        Game storage game = games[gameId];
        
        require(game.state == GameState.REGISTRATION, "Not registration state");
        require(game.players.length < MAX_PLAYERS, "Game full");
        require(playerCurrentGame[msg.sender] == 0, "Already in a game");
        
        // Add player to game
        game.players.push(msg.sender);
        Player storage playerData = game.playerInfo[msg.sender];
        playerData.isActive = true;
        playerData.chipBalance = INITIAL_CHIPS;
        playerData.lastActionTime = block.timestamp;
        
        // Track which game the player is in
        playerCurrentGame[msg.sender] = gameId;
        
        // Increment active player count
        unchecked { game.activePlayerCount++; }
        
        emit PlayerJoined(gameId, msg.sender);
    }
    
    // Authorized keepers can add players directly
    function addPlayerToGame(uint256 gameId, address player) external onlyKeeper gameExists(gameId) {
        Game storage game = games[gameId];
        
        require(game.state == GameState.REGISTRATION, "Not registration state");
        require(game.players.length < MAX_PLAYERS, "Game full");
        require(playerCurrentGame[player] == 0, "Player already in a game");
        
        // Add player to game
        game.players.push(player);
        Player storage playerData = game.playerInfo[player];
        playerData.isActive = true;
        playerData.chipBalance = INITIAL_CHIPS;
        playerData.lastActionTime = block.timestamp;
        
        // Track which game the player is in
        playerCurrentGame[player] = gameId;
        
        // Increment active player count
        unchecked { game.activePlayerCount++; }
        
        emit PlayerJoined(gameId, player);
    }
    
    // Keeper starts the peek phase
    function startPeekPhase(uint256 gameId) external onlyKeeper gameExists(gameId) {
        Game storage game = games[gameId];
        
        require(game.state == GameState.REGISTRATION, "Not registration state");
        require(game.players.length >= 2, "Need 2+ players");
        
        // Initialize and shuffle the deck using Fisher-Yates algorithm
        _initializeDeck(gameId);
        
        // Deal cards to players
        _dealCards(gameId);
        
        // Set timeframe for the peek phase
        game.phaseEndTime = block.timestamp + PEEK_PHASE_DURATION;
        
        // Move to peek phase
        game.state = GameState.PEEK_PHASE;
        
        // Client will calculate endTime = block.timestamp + PEEK_PHASE_DURATION
        emit PeekPhaseStarted(gameId);
    }
    
    // Helper function to initialize the deck with Fisher-Yates shuffle using prevrandao
    function _initializeDeck(uint256 gameId) private {
        Game storage game = games[gameId];
        
        // Clear any existing cards
        delete game.deck;
        
        // Create a standard 52-card deck
        for (uint8 suit = 0; suit < 4; suit++) {
            for (uint8 value = 2; value <= 14; value++) {
                game.deck.push(Card(value, suit));
            }
        }
        
        // Perform Fisher-Yates shuffle using TEN Network's secure PREVRANDAO
        uint256 prevrandao = block.prevrandao;
        
        for (uint256 i = STANDARD_DECK_SIZE - 1; i > 0; i--) {
            // Generate random index j such that 0 <= j <= i using PREVRANDAO
            uint256 j = uint256(keccak256(abi.encodePacked(prevrandao, i))) % (i + 1);
            
            // Swap elements at indices i and j
            Card memory temp = game.deck[i];
            game.deck[i] = game.deck[j];
            game.deck[j] = temp;
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
    function peekAtCard(uint256 gameId) external gameExists(gameId) activePlayer(gameId) {
        Game storage game = games[gameId];
        Player storage player = game.playerInfo[msg.sender];
        
        require(game.state == GameState.PEEK_PHASE, "Not peek phase");
        require(block.timestamp < game.phaseEndTime, "Peek phase ended");
        require(!player.hasPeeked, "Already peeked");
        require(player.chipBalance >= PEEK_FEE, "Insufficient chips");
        
        // Deduct the peek fee
        unchecked { player.chipBalance -= PEEK_FEE; }
        player.hasPeeked = true;
        player.lastActionTime = block.timestamp;
        
        // Get the player's card
        uint8 cardIdx = player.cardIdx;
        Card memory playerCard = game.deck[cardIdx];
        
        // Use a private event to notify the player of their card
        emit CardRevealed(msg.sender, playerCard.value, playerCard.suit);
        
        // Combined player action event
        emit PlayerAction(gameId, msg.sender, "peek", PEEK_FEE);
    }
    
    // Function to swap a card after peeking - using bitmap for efficiency
    function swapCard(uint256 gameId) external gameExists(gameId) activePlayer(gameId) {
        Game storage game = games[gameId];
        Player storage player = game.playerInfo[msg.sender];
        
        require(game.state == GameState.PEEK_PHASE, "Not peek phase");
        require(block.timestamp < game.phaseEndTime, "Peek phase ended");
        require(player.hasPeeked, "Must peek first");
        require(!player.hasSwapped, "Already swapped");
        require(player.chipBalance >= SWAP_FEE, "Insufficient chips");
        
        // Deduct the swap fee and mark as swapped
        unchecked { player.chipBalance -= SWAP_FEE; }
        player.hasSwapped = true;
        player.lastActionTime = block.timestamp;
        
        // Mark the current card as unassigned
        _unassignCard(gameId, player.cardIdx);
        
        // Get a new unassigned card efficiently using prevrandao
        uint8 newCardIdx = _getUnassignedCardIndex(gameId);
        
        // Mark the new card as assigned and update player
        _assignCard(gameId, newCardIdx);
        player.cardIdx = newCardIdx;
        
        // Combined player action event
        emit PlayerAction(gameId, msg.sender, "swap", SWAP_FEE);
    }
    
    // Optimized helper to get an unassigned card using bitmap and prevrandao
    function _getUnassignedCardIndex(uint256 gameId) private view returns (uint8) {
        Game storage game = games[gameId];
        
        // Start searching from a position determined by prevrandao
        uint256 startPos = block.prevrandao % STANDARD_DECK_SIZE;
        
        // Find the first unassigned card
        for (uint256 i = 0; i < STANDARD_DECK_SIZE; i++) {
            uint8 idx = uint8((startPos + i) % STANDARD_DECK_SIZE);
            if (!_isCardAssigned(gameId, idx)) {
                return idx;
            }
        }
        
        // Fallback (should never reach here as we always have unassigned cards)
        revert("No unassigned cards");
    }
    
    // Keeper ends peek phase and starts betting phase
    function endPeekPhase(uint256 gameId) external onlyKeeper gameExists(gameId) {
        Game storage game = games[gameId];
        
        require(game.state == GameState.PEEK_PHASE, "Not peek phase");
        require(block.timestamp >= game.phaseEndTime, "Peek phase not finished");
        
        // Start betting phase
        game.state = GameState.BETTING;
        game.phaseEndTime = block.timestamp + BETTING_PHASE_DURATION;
        
        // Client will calculate endTime = block.timestamp + BETTING_PHASE_DURATION
        emit BettingPhaseStarted(gameId);
    }
    
    // Function for players to place bets
    function placeBet(uint256 gameId, uint256 betAmount) external gameExists(gameId) activePlayer(gameId) {
        Game storage game = games[gameId];
        Player storage player = game.playerInfo[msg.sender];
        
        require(game.state == GameState.BETTING, "Not betting phase");
        require(block.timestamp < game.phaseEndTime, "Betting phase ended");
        require(!player.hasFolded, "Already folded");
        require(betAmount >= MINIMUM_BET, "Bet too small");
        
        // If there's already a bet in this round, we must match or raise
        if (game.currentBetAmount > 0) {
            uint256 requiredAmount = game.currentBetAmount - player.currentBet;
            require(betAmount >= requiredAmount, "Must match current bet");
        }
        
        require(player.chipBalance >= betAmount, "Insufficient chips");
        
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
        
        // Unified player action event
        emit PlayerAction(gameId, msg.sender, "bet", betAmount);
    }
    
    // Function for players to fold
    function fold(uint256 gameId) external gameExists(gameId) activePlayer(gameId) {
        Game storage game = games[gameId];
        Player storage player = game.playerInfo[msg.sender];
        
        require(game.state == GameState.BETTING, "Not betting phase");
        require(block.timestamp < game.phaseEndTime, "Betting phase ended");
        require(!player.hasFolded, "Already folded");
        
        player.hasFolded = true;
        player.lastActionTime = block.timestamp;
        
        // Update active player count
        unchecked { game.activePlayerCount--; }
        
        // Unified player action event
        emit PlayerAction(gameId, msg.sender, "fold", 0);
        
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
    function endBettingPhase(uint256 gameId) external onlyKeeper gameExists(gameId) {
        Game storage game = games[gameId];
        
        require(game.state == GameState.BETTING, "Not betting phase");
        require(block.timestamp >= game.phaseEndTime, "Betting phase not finished");
        
        _startShowdown(gameId);
    }
    
    // Start the showdown phase
    function _startShowdown(uint256 gameId) private {
        Game storage game = games[gameId];
        
        game.state = GameState.SHOWDOWN;
        
        emit ShowdownStarted(gameId);
        
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
            Card memory playerCard = game.deck[cardIdx];
            emit CardRevealed(player, playerCard.value, playerCard.suit);
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
            Card memory playerCard = game.deck[cardIdx];
            
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
        game.state = GameState.ENDED;
        
        uint256 potAmount = game.potAmount;
        emit GameEnded(gameId, winner, potAmount);
        
        // Reset game state for cleanup
        game.potAmount = 0;
        game.currentBetAmount = 0;
    }
    
    // Check if all players have matched the current bet - for keeper service
    function checkAllPlayersMatched(uint256 gameId) external view gameExists(gameId) returns (bool) {
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
    
    // Get active player count using the cached value
    function getActivePlayerCount(uint256 gameId) external view gameExists(gameId) returns (uint256) {
        return games[gameId].activePlayerCount;
    }
    
    // Combined function to get all game and phase information in a single call
    function getGameInfo(uint256 gameId) external view gameExists(gameId) returns (
        GameState state,
        uint256 potAmount,
        uint256 currentBet,
        uint256 phaseEndTime,
        uint256 remainingTime,
        uint256 playerCount,
        uint256 activeCount,
        address gameKeeper
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
            game.gameKeeper
        );
    }
    
    // Get player information - combined to reduce gas costs for frontend
    function getPlayerInfo(uint256 gameId, address player) external view gameExists(gameId) returns (
        bool isActive,
        bool hasPeeked,
        bool hasSwapped,
        bool hasFolded,
        uint256 chipBalance,
        uint256 currentBet,
        uint256 lastActionTime
    ) {
        Game storage game = games[gameId];
        Player storage playerData = game.playerInfo[player];
        
        return (
            playerData.isActive,
            playerData.hasPeeked,
            playerData.hasSwapped,
            playerData.hasFolded,
            playerData.chipBalance,
            playerData.currentBet,
            playerData.lastActionTime
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
    
    // Function for a player to leave the game if it hasn't started
    function leaveGame(uint256 gameId) external gameExists(gameId) {
        Game storage game = games[gameId];
        
        require(game.playerInfo[msg.sender].isActive, "Not in this game");
        require(game.state == GameState.REGISTRATION, "Game already started");
        
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
        
        // Emit player action for leaving
        emit PlayerAction(gameId, msg.sender, "leave", 0);
    }
    
    // Function to clean up after a game
    function cleanup(uint256 gameId) external onlyKeeper gameExists(gameId) {
        Game storage game = games[gameId];
        
        require(game.state == GameState.ENDED, "Game not ended");
        
        // Clear the player's current game tracking
        for (uint256 i = 0; i < game.players.length; i++) {
            address player = game.players[i];
            playerCurrentGame[player] = 0;
        }
    }
}