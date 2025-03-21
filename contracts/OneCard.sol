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
    
    // Card representation (values 2-14, suits 0-3)
    struct Card {
        uint8 value;
        uint8 suit;
    }
    
    // Game state enumeration
    enum GameState { 
        REGISTRATION,
        PEEK_PHASE,
        BETTING,
        SHOWDOWN,
        ENDED
    }
    
    // Player state structure
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
    
    constructor() {
        _owner = msg.sender;
    }
    
    function owner() public view returns (address) {
        return _owner;
    }
}
