// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./PokerCardLibrary.sol";
import "./PokerGameLibrary.sol";

// Interface for the main poker contract
interface IOneCard {
    // Game access functions
    function getActiveGames() external view returns (uint256[] memory);
    function getGameInfo(uint256 gameId) external view returns (
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
    );
    
    // Spectating specific functions - new split version
    function getGameBasicInfo(uint256 gameId) external view returns (
        GameLibrary.GameState state,
        uint256 potAmount,
        uint256 currentBet,
        uint256 phaseEndTime,
        uint256 bufferEndTime,
        uint256 playerCount,
        uint256 activeCount,
        uint256 stateVersion,
        bool isCleanedUp
    );
    
    function getPlayersForSpectating(uint256 gameId) external view returns (
        address[] memory playerAddresses,
        bool[] memory playerActiveBits,
        bool[] memory playerFoldedBits,
        uint256[] memory playerChipBalances,
        uint256[] memory playerCurrentBets,
        uint256[] memory playerActionNonces,
        string[] memory playerLastActionRationals
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
        bool hasSwappedCard,
        bool hasFolded,
        uint256 chipBalance,
        uint256 currentBet,
        uint256 lastActionTime,
        uint256 actionNonce,
        string memory lastActionRational
    );
    
    // Game state events that need to be listened to
    event GameCreated(uint256 indexed gameId, address keeper);
    event PlayerJoined(uint256 indexed gameId, address indexed player);
    event PeekPhaseStarted(uint256 indexed gameId);
    event BufferPeriodStarted(uint256 indexed gameId, GameLibrary.GameState currentState, GameLibrary.GameState nextState);
    event BettingPhaseStarted(uint256 indexed gameId);
    event PlayerActionType(uint256 indexed gameId, address player, string actionType);
    event CardSwapped(address indexed player, uint8 oldValue, uint8 oldSuit);
    event ShowdownStarted(uint256 indexed gameId);
    event GameEnded(uint256 indexed gameId, address indexed winner, uint256 potAmount);
    
    // Spectator specific events
    event GameSpectatable(uint256 indexed gameId, GameLibrary.GameState state, uint256 playerCount);
    event GameNoLongerSpectatable(uint256 indexed gameId);
    event GameStateUpdated(uint256 indexed gameId, GameLibrary.GameState state, uint256 potAmount, uint256 currentBet, uint256 stateVersion);
}

// SpectatorView contract - to separate view functions for spectating
contract PokerSpectatorView {
    IOneCard private pokerContract;
    
    // Mirror events from the main contract for easier frontend integration
    event GameCreated(uint256 indexed gameId, address keeper);
    event PlayerJoined(uint256 indexed gameId, address indexed player);
    event PeekPhaseStarted(uint256 indexed gameId);
    event BufferPeriodStarted(uint256 indexed gameId, GameLibrary.GameState currentState, GameLibrary.GameState nextState);
    event BettingPhaseStarted(uint256 indexed gameId);
    event PlayerActionType(uint256 indexed gameId, address player, string actionType);
    event CardSwapped(address indexed player, uint8 oldValue, uint8 oldSuit);
    event ShowdownStarted(uint256 indexed gameId);
    event GameEnded(uint256 indexed gameId, address indexed winner, uint256 potAmount);
    event GameSpectatable(uint256 indexed gameId, GameLibrary.GameState state, uint256 playerCount);
    event GameNoLongerSpectatable(uint256 indexed gameId);
    event GameStateUpdated(uint256 indexed gameId, GameLibrary.GameState state, uint256 potAmount, uint256 currentBet, uint256 stateVersion);
    
    constructor(address _pokerContractAddress) {
        pokerContract = IOneCard(_pokerContractAddress);
    }
    
    // Basic game information functions
    function getActiveGames() external view returns (uint256[] memory) {
        return pokerContract.getActiveGames();
    }
    
    // Game state - minimal functions to avoid stack too deep issues
    function getGamePhase(uint256 gameId) external view returns (GameLibrary.GameState) {
        (GameLibrary.GameState state, , , , , , , , ) = pokerContract.getGameBasicInfo(gameId);
        return state;
    }
    
    function getPotInfo(uint256 gameId) external view returns (uint256 potAmount, uint256 currentBet) {
        (
            , // state
            uint256 pot, 
            uint256 bet, 
            , // phaseEndTime 
            , // bufferEndTime
            , // playerCount
            , // activeCount
            , // stateVersion
            // isCleanedUp
        ) = pokerContract.getGameBasicInfo(gameId);
        return (pot, bet);
    }
    
    function getTimingInfo(uint256 gameId) external view returns (uint256 phaseEndTime, uint256 bufferEndTime) {
        (
            , // state
            , // potAmount 
            , // currentBet
            uint256 phaseEnd, 
            uint256 bufferEnd,
            , // playerCount
            , // activeCount
            , // stateVersion
            // isCleanedUp
        ) = pokerContract.getGameBasicInfo(gameId);
        return (phaseEnd, bufferEnd);
    }
    
    function getGameVersion(uint256 gameId) external view returns (uint256 stateVersion, bool isCleanedUp) {
        (
            , // state
            , // potAmount
            , // currentBet
            , // phaseEndTime
            , // bufferEndTime
            , // playerCount
            , // activeCount
            uint256 version,
            bool cleaned
        ) = pokerContract.getGameBasicInfo(gameId);
        return (version, cleaned);
    }
    
    function getPlayerCounts(uint256 gameId) external view returns (uint256 playerCount, uint256 activeCount) {
        (
            , // state
            , // potAmount
            , // currentBet
            , // phaseEndTime
            , // bufferEndTime
            uint256 players,
            uint256 active,
            , // stateVersion
            // isCleanedUp
        ) = pokerContract.getGameBasicInfo(gameId);
        return (players, active);
    }
    
    function getGameKeeper(uint256 gameId) external view returns (address) {
        (
            , // state
            , // potAmount
            , // currentBet
            , // phaseEndTime
            , // bufferEndTime
            , // remainingTime
            , // playerCount
            , // activeCount
            address keeper,
            , // stateVersion
            // isCleanedUp
        ) = pokerContract.getGameInfo(gameId);
        return keeper;
    }
    
    function getRemainingTime(uint256 gameId) external view returns (uint256) {
        (
            , // state
            , // potAmount
            , // currentBet
            uint256 phaseEndTime,
            , // bufferEndTime
            , // playerCount
            , // activeCount
            , // stateVersion
            // isCleanedUp
        ) = pokerContract.getGameBasicInfo(gameId);
        return block.timestamp < phaseEndTime ? phaseEndTime - block.timestamp : 0;
    }
    
    // Super lightweight polling - just returns the version without any other data
    function getStateVersionQuick(uint256 gameId) external view returns (uint256) {
        (
            , // state
            , // potAmount
            , // currentBet
            , // phaseEndTime
            , // bufferEndTime
            , // playerCount
            , // activeCount
            uint256 version,
              // isCleanedUp
        ) = pokerContract.getGameBasicInfo(gameId);
        return version;
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
        bool hasSwappedCard,
        bool hasFolded,
        uint256 chipBalance,
        uint256 currentBet,
        uint256 lastActionTime,
        uint256 actionNonce,
        string memory lastActionRational
    ) {
        return pokerContract.getPlayerInfo(gameId, player);
    }
    
    // Spectator data
    function getSpectatorPlayerData(uint256 gameId) external view returns (
        address[] memory playerAddresses,
        bool[] memory playerActiveBits,
        bool[] memory playerFoldedBits,
        uint256[] memory playerChipBalances,
        uint256[] memory playerCurrentBets,
        uint256[] memory playerActionNonces,
        string[] memory playerLastActionRationals
    ) {
        return pokerContract.getPlayersForSpectating(gameId);
    }
    
    // Card data during showdown/ended phases
    function areCardsViewable(uint256 gameId) external view returns (bool) {
        (GameLibrary.GameState state, , , , , , , , ) = pokerContract.getGameBasicInfo(gameId);
        return (state == GameLibrary.GameState.SHOWDOWN || state == GameLibrary.GameState.ENDED);
    }
    
    function getSpectatorCardData(uint256 gameId) external view returns (
        address[] memory playerAddresses,
        uint8[] memory cardValues,
        uint8[] memory cardSuits
    ) {
        return pokerContract.getRevealedCardsForSpectating(gameId);
    }
}