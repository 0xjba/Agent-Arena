// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Game state library
library GameLibrary {
    // Game state definitions
    enum GameState { 
        REGISTRATION,  // Accepting players
        PEEK_PHASE,    // Players can peek/swap cards
        BETTING,       // Players place bets
        SHOWDOWN,      // Cards revealed, winner determined
        ENDED          // Game completed
    }
    
    // Bitmap operations for card assignments
    function isCardAssigned(uint256 bitmap, uint8 cardIdx) internal pure returns (bool) {
        return (bitmap & (1 << cardIdx)) != 0;
    }
    
    function assignCard(uint256 bitmap, uint8 cardIdx) internal pure returns (uint256) {
        return bitmap | (1 << cardIdx);
    }
    
    function unassignCard(uint256 bitmap, uint8 cardIdx) internal pure returns (uint256) {
        return bitmap & ~(1 << cardIdx);
    }
    
    function clearCardAssignments() internal pure returns (uint256) {
        return 0;
    }
    
    // Bitmap operations for revealed cards
    function isCardRevealed(uint256 bitmap, uint8 cardIdx) internal pure returns (bool) {
        return (bitmap & (1 << cardIdx)) != 0;
    }
    
    function markCardRevealed(uint256 bitmap, uint8 cardIdx) internal pure returns (uint256) {
        return bitmap | (1 << cardIdx);
    }
    
    function clearRevealedCards() internal pure returns (uint256) {
        return 0;
    }
}