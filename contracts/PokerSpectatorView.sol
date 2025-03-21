// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./PokerCardLibrary.sol";
import "./PokerGameLibrary.sol";

// Interface for the main poker contract
interface IHiddenOneCardPoker {
    // Game access functions
    function getActiveGames() external view returns (uint256[] memory);
    function getGameInfo(uint256 gameId) external view returns (
        GameLibrary.GameState state,
        uint256 potAmount,
        uint256 currentBet,
        uint256 phaseEndTime,
        uint256 remainingTime,
        uint256 playerCount,
        uint256 activeCount,
        address gameKeeper
    );
    
    // Spectating specific functions
    function getGameStateForSpectating(uint256 gameId) external view returns (
        GameLibrary.GameState state,
        uint256 potAmount,
        uint256 currentBet,
        uint256 phaseEndTime,
        uint256 playerCount,
        uint256 activeCount,
        address[] memory playerAddresses,
        bool[] memory playerActiveBits,
        bool[] memory playerFoldedBits,
        uint256[] memory playerChipBalances,
        uint256[] memory playerCurrentBets
    );
    function getRevealedCardsForSpectating(uint256 gameId) external view returns (
        address[] memory playerAddresses,
        uint8[] memory cardValues,
        uint8[] memory cardSuits
    );
    
    // Player info functions
    function getPlayers(uint256 gameId) external view returns (address[] memory players);
    function getActivePlayers(uint256 gameId) external view returns (address[] memory activePlayers);
    function getActivePlayerCount(uint256 gameId) external view returns (uint256);
    function getPlayerInfo(uint256 gameId, address player) external view returns (
        bool isActive,
        bool hasPeeked,
        bool usedMontyHall,
        bool hasFolded,
        uint256 chipBalance,
        uint256 currentBet,
        uint256 lastActionTime
    );
    
    // Game state events that need to be listened to
    event GameCreated(uint256 indexed gameId, address keeper);
    event PlayerJoined(uint256 indexed gameId, address indexed player);
    event PeekPhaseStarted(uint256 indexed gameId);
    event BettingPhaseStarted(uint256 indexed gameId);
    event PlayerAction(uint256 indexed gameId, address indexed player, string action, uint256 amount);
    event ShowdownStarted(uint256 indexed gameId);
    event GameEnded(uint256 indexed gameId, address indexed winner, uint256 potAmount);
    
    // Spectator specific events
    event GameSpectatable(uint256 indexed gameId, GameLibrary.GameState state, uint256 playerCount);
    event GameNoLongerSpectatable(uint256 indexed gameId);
    event GameStateUpdated(uint256 indexed gameId, GameLibrary.GameState state, uint256 potAmount, uint256 currentBet);
}

// SpectatorView contract - to separate view functions for spectating
contract PokerSpectatorView {
    IHiddenOneCardPoker private pokerContract;
    
    // Mirror events from the main contract for easier frontend integration
    event GameCreated(uint256 indexed gameId, address keeper);
    event PlayerJoined(uint256 indexed gameId, address indexed player);
    event PeekPhaseStarted(uint256 indexed gameId);
    event BettingPhaseStarted(uint256 indexed gameId);
    event PlayerAction(uint256 indexed gameId, address indexed player, string action, uint256 amount);
    event ShowdownStarted(uint256 indexed gameId);
    event GameEnded(uint256 indexed gameId, address indexed winner, uint256 potAmount);
    event GameSpectatable(uint256 indexed gameId, GameLibrary.GameState state, uint256 playerCount);
    event GameNoLongerSpectatable(uint256 indexed gameId);
    event GameStateUpdated(uint256 indexed gameId, GameLibrary.GameState state, uint256 potAmount, uint256 currentBet);
    
    constructor(address _pokerContractAddress) {
        pokerContract = IHiddenOneCardPoker(_pokerContractAddress);
    }
    
    // Basic game information functions
    function getActiveGames() external view returns (uint256[] memory) {
        return pokerContract.getActiveGames();
    }
    
    function getGameInfo(uint256 gameId) external view returns (
        GameLibrary.GameState state,
        uint256 potAmount,
        uint256 currentBet,
        uint256 phaseEndTime,
        uint256 remainingTime,
        uint256 playerCount,
        uint256 activeCount,
        address gameKeeper
    ) {
        return pokerContract.getGameInfo(gameId);
    }
    
    // Player information
    function getPlayers(uint256 gameId) external view returns (address[] memory) {
        return pokerContract.getPlayers(gameId);
    }
    
    function getActivePlayers(uint256 gameId) external view returns (address[] memory) {
        return pokerContract.getActivePlayers(gameId);
    }
    
    function getActivePlayerCount(uint256 gameId) external view returns (uint256) {
        return pokerContract.getActivePlayerCount(gameId);
    }
    
    function getPlayerInfo(uint256 gameId, address player) external view returns (
        bool isActive,
        bool hasPeeked,
        bool usedMontyHall,
        bool hasFolded,
        uint256 chipBalance,
        uint256 currentBet,
        uint256 lastActionTime
    ) {
        return pokerContract.getPlayerInfo(gameId, player);
    }
    
    // Get full game state for spectating
    function getGameFullState(uint256 gameId) external view returns (
        GameLibrary.GameState state,
        uint256 potAmount,
        uint256 currentBet,
        uint256 phaseEndTime,
        uint256 playerCount,
        uint256 activeCount,
        address[] memory playerAddresses,
        bool[] memory playerActiveBits,
        bool[] memory playerFoldedBits,
        uint256[] memory playerChipBalances,
        uint256[] memory playerCurrentBets,
        // Card data - empty for active games, filled for showdown/ended
        uint8[] memory cardValues,
        uint8[] memory cardSuits
    ) {
        // Get game state
        (
            state,
            potAmount,
            currentBet,
            phaseEndTime,
            playerCount,
            activeCount,
            playerAddresses,
            playerActiveBits,
            playerFoldedBits,
            playerChipBalances,
            playerCurrentBets
        ) = pokerContract.getGameStateForSpectating(gameId);
        
        // Initialize empty arrays for cards
        cardValues = new uint8[](playerCount);
        cardSuits = new uint8[](playerCount);
        
        // If game is in showdown or ended, also get the card info
        if (state == GameLibrary.GameState.SHOWDOWN || state == GameLibrary.GameState.ENDED) {
            address[] memory cardPlayerAddresses;
            (
                cardPlayerAddresses,
                cardValues,
                cardSuits
            ) = pokerContract.getRevealedCardsForSpectating(gameId);
            
            // Ensure the card data is mapped to the correct players
            if (cardPlayerAddresses.length > 0) {
                uint8[] memory tempValues = new uint8[](playerCount);
                uint8[] memory tempSuits = new uint8[](playerCount);
                
                // Match card data to players
                for (uint256 i = 0; i < playerCount; i++) {
                    address player = playerAddresses[i];
                    
                    // Find player in card data
                    for (uint256 j = 0; j < cardPlayerAddresses.length; j++) {
                        if (cardPlayerAddresses[j] == player) {
                            tempValues[i] = cardValues[j];
                            tempSuits[i] = cardSuits[j];
                            break;
                        }
                    }
                }
                
                // Update the arrays
                cardValues = tempValues;
                cardSuits = tempSuits;
            }
        }
        
        return (
            state,
            potAmount,
            currentBet,
            phaseEndTime,
            playerCount,
            activeCount,
            playerAddresses,
            playerActiveBits,
            playerFoldedBits,
            playerChipBalances,
            playerCurrentBets,
            cardValues,
            cardSuits
        );
    }
}