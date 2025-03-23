// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./PokerGameLibrary.sol";

/**
 * @title SpectatorBetting
 * @dev Contract to allow spectators to bet on players in OneCard poker games
 */
contract SpectatorBetting {
    using GameLibrary for GameLibrary.GameState;
    
    // Reference to the main OneCard contract
    address public immutable oneCardContract;
    address public immutable owner;
    
    // Game tracking
    mapping(uint256 => Game) public games; // gameId => Game
    
    // Structure to track spectator bets
    struct Bet {
        address playerBetOn;
        uint256 amount;
        bool claimed;
    }
    
    // Structure to track game information
    struct Game {
        uint256 gameId;
        bool bettingOpen;
        bool resultsProcessed;
        uint256 totalBetAmount;
        address winner;
        mapping(address => uint256) totalBetOnPlayer; // player => total amount bet on them
        mapping(address => Bet) bets; // bettor => Bet (one bet per spectator)
    }
    
    // Events
    event BettingOpened(uint256 indexed gameId);
    event BettingClosed(uint256 indexed gameId);
    event BetPlaced(uint256 indexed gameId, address bettor, address indexed playerBetOn, uint256 amount);
    event ResultsProcessed(uint256 indexed gameId, address winner);
    event WinningsClaimed(uint256 indexed gameId, address bettor, uint256 amount);
    
    constructor(address _oneCardContract) {
        oneCardContract = _oneCardContract;
        owner = msg.sender;
    }
    
    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Not the owner");
        _;
    }
    
    modifier onlyOneCardContract() {
        require(msg.sender == oneCardContract, "Only OneCard contract can call");
        _;
    }
    
    /**
     * @dev Opens betting for a new game (called by OneCard contract when a game is created)
     * @param gameId The ID of the game
     */
    function openBetting(uint256 gameId) external onlyOneCardContract {
        require(!games[gameId].bettingOpen, "Betting already open for this game");
        
        games[gameId].gameId = gameId;
        games[gameId].bettingOpen = true;
        games[gameId].resultsProcessed = false;
        
        emit BettingOpened(gameId);
    }
    
    /**
     * @dev Closes betting for a game (called by OneCard contract when peek phase starts)
     * @param gameId The ID of the game
     */
    function closeBetting(uint256 gameId) external onlyOneCardContract {
        require(games[gameId].bettingOpen, "Betting not open");
        
        games[gameId].bettingOpen = false;
        emit BettingClosed(gameId);
    }
    
    /**
     * @dev Place a bet on a player
     * @param gameId The ID of the game
     * @param playerToBetOn The address of the player to bet on
     */
    function placeBet(uint256 gameId, address playerToBetOn) external payable {
        require(games[gameId].bettingOpen, "Betting not open for this game");
        require(msg.value > 0, "Bet amount must be greater than 0");
        require(games[gameId].bets[msg.sender].amount == 0, "Already placed a bet in this game");
        
        // Verify player is in the game (would be good to have this check but depends on OneCard contract interface)
        // We assume player validation is handled by the frontend or a separate validation method
        
        // Record the bet
        games[gameId].bets[msg.sender] = Bet({
            playerBetOn: playerToBetOn,
            amount: msg.value,
            claimed: false
        });
        
        games[gameId].totalBetOnPlayer[playerToBetOn] += msg.value;
        games[gameId].totalBetAmount += msg.value;
        
        emit BetPlaced(gameId, msg.sender, playerToBetOn, msg.value);
    }
    
    /**
     * @dev Process results after a game has ended (called by OneCard contract)
     * @param gameId The ID of the game
     * @param winner The address of the player who won
     */
    function processResults(uint256 gameId, address winner) external onlyOneCardContract {
        require(!games[gameId].bettingOpen, "Betting must be closed");
        require(!games[gameId].resultsProcessed, "Results already processed");
        
        games[gameId].winner = winner;
        games[gameId].resultsProcessed = true;
        
        emit ResultsProcessed(gameId, winner);
    }
    
    /**
     * @dev Claim winnings after a game has ended
     * @param gameId The ID of the completed game
     */
    function claimWinnings(uint256 gameId) external {
        require(games[gameId].resultsProcessed, "Results not processed yet");
        
        Bet storage bet = games[gameId].bets[msg.sender];
        require(bet.amount > 0, "No bet placed");
        require(!bet.claimed, "Winnings already claimed");
        
        address winner = games[gameId].winner;
        
        // Check if bettor bet on the winner
        if (bet.playerBetOn == winner) {
            // Calculate winnings
            uint256 totalBetOnWinner = games[gameId].totalBetOnPlayer[winner];
            uint256 totalPot = games[gameId].totalBetAmount;
            
            // Proportion of winning pool
            uint256 winnerShare = (bet.amount * totalPot) / totalBetOnWinner;
            
            // Mark as claimed
            bet.claimed = true;
            
            // Transfer winnings
            payable(msg.sender).transfer(winnerShare);
            
            emit WinningsClaimed(gameId, msg.sender, winnerShare);
        } else {
            // If they didn't bet on the winner, just mark as claimed
            bet.claimed = true;
        }
    }
    
    /**
     * @dev Check if a bettor has winnings to claim
     * @param gameId The ID of the game
     * @param bettor The address of the bettor
     * @return hasWinnings Whether the bettor has winnings to claim
     * @return amount The amount of winnings available (0 if none)
     */
    function checkWinnings(uint256 gameId, address bettor) external view returns (bool hasWinnings, uint256 amount) {
        if (!games[gameId].resultsProcessed) {
            return (false, 0);
        }
        
        Bet storage bet = games[gameId].bets[bettor];
        
        if (bet.amount == 0 || bet.claimed) {
            return (false, 0);
        }
        
        address winner = games[gameId].winner;
        
        if (bet.playerBetOn != winner) {
            return (false, 0);
        }
        
        // Calculate winnings
        uint256 totalBetOnWinner = games[gameId].totalBetOnPlayer[winner];
        uint256 totalPot = games[gameId].totalBetAmount;
        
        // Proportion of winning pool
        uint256 winnerShare = (bet.amount * totalPot) / totalBetOnWinner;
        
        return (true, winnerShare);
    }
    
    /**
     * @dev Get bet information for a bettor
     * @param gameId The ID of the game
     * @param bettor The address of the bettor
     */
    function getBetInfo(uint256 gameId, address bettor) external view returns (
        address playerBetOn,
        uint256 amount,
        bool claimed
    ) {
        Bet storage bet = games[gameId].bets[bettor];
        return (bet.playerBetOn, bet.amount, bet.claimed);
    }
    
    /**
     * @dev Get game information
     * @param gameId The ID of the game
     */
    function getGameInfo(uint256 gameId) external view returns (
        bool bettingOpen,
        bool resultsProcessed,
        uint256 totalBetAmount,
        address winner
    ) {
        Game storage game = games[gameId];
        return (
            game.bettingOpen,
            game.resultsProcessed,
            game.totalBetAmount,
            game.winner
        );
    }
    
    /**
     * @dev Get total bet on a player
     * @param gameId The ID of the game
     * @param player The player address
     */
    function getTotalBetOnPlayer(uint256 gameId, address player) external view returns (uint256) {
        return games[gameId].totalBetOnPlayer[player];
    }
}