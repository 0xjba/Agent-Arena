// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title Poker Game Library for TEN Network
 * @notice TEN Network is powered by Trusted Execution Environments (TEEs) which provide
 * encrypted private shared states for blockchain applications. This library
 * leverages TEN's capabilities for secure game state management.
 *
 * @dev This library contains game state definitions and bitmap operations for efficient
 * card assignment tracking. The TEN Network's privacy features ensure that game state
 * information is only visible to authorized participants.
 */
library GameLibrary {
    /**
     * @dev Game state enum representing the different phases of the poker game
     */
    enum GameState { 
        PRE_GAME,     // Players can join the game
        PEEK_PHASE,   // Players can peek at and optionally swap their cards
        BETTING,      // Players place bets or fold
        SHOWDOWN,     // Cards are revealed and winner is determined
        ENDED         // Game is completed and can be cleaned up
    }
    
    /**
     * @notice Checks if a card is assigned to a player
     * @dev Uses bitmap for gas-efficient card assignment tracking
     * @param bitmap The bitmap representing card assignments
     * @param cardIdx The index of the card to check
     * @return True if the card is assigned, false otherwise
     */
    function isCardAssigned(uint256 bitmap, uint8 cardIdx) internal pure returns (bool) {
        return (bitmap & (1 << cardIdx)) != 0;
    }
    
    /**
     * @notice Marks a card as assigned to a player
     * @dev Sets the bit at cardIdx position to 1
     * @param bitmap The current bitmap of card assignments
     * @param cardIdx The index of the card to assign
     * @return Updated bitmap with the card marked as assigned
     */
    function assignCard(uint256 bitmap, uint8 cardIdx) internal pure returns (uint256) {
        return bitmap | (1 << cardIdx);
    }
    
    /**
     * @notice Unassigns a card from a player
     * @dev Sets the bit at cardIdx position to 0
     * @param bitmap The current bitmap of card assignments
     * @param cardIdx The index of the card to unassign
     * @return Updated bitmap with the card marked as unassigned
     */
    function unassignCard(uint256 bitmap, uint8 cardIdx) internal pure returns (uint256) {
        return bitmap & ~(1 << cardIdx);
    }
    
    /**
     * @notice Clears all card assignments
     * @dev Resets the bitmap to zero
     * @return A zero value representing no cards assigned
     */
    function clearCardAssignments() internal pure returns (uint256) {
        return 0;
    }
    
    /**
     * @notice Checks if a card has been revealed
     * @dev Uses bitmap for gas-efficient card reveal tracking
     * @param bitmap The bitmap representing revealed cards
     * @param cardIdx The index of the card to check
     * @return True if the card is revealed, false otherwise
     */
    function isCardRevealed(uint256 bitmap, uint8 cardIdx) internal pure returns (bool) {
        return (bitmap & (1 << cardIdx)) != 0;
    }
    
    /**
     * @notice Marks a card as revealed
     * @dev Sets the bit at cardIdx position to 1
     * @param bitmap The current bitmap of revealed cards
     * @param cardIdx The index of the card to mark as revealed
     * @return Updated bitmap with the card marked as revealed
     */
    function markCardRevealed(uint256 bitmap, uint8 cardIdx) internal pure returns (uint256) {
        return bitmap | (1 << cardIdx);
    }
    
    /**
     * @notice Clears all card revelation markings
     * @dev Resets the bitmap to zero
     * @return A zero value representing no cards revealed
     */
    function clearRevealedCards() internal pure returns (uint256) {
        return 0;
    }
}