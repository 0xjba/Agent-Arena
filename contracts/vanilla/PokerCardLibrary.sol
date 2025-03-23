// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title Poker Card Library for TEN Network
 * @notice TEN Network is powered by Trusted Execution Environments (TEEs) which provide
 * encrypted private shared states for blockchain applications. This library
 * leverages TEN's capabilities for secure card operations in a poker game.
 *
 * @dev This library contains card representations and deck operations used in the OneCard poker game.
 * The TEN Network's TEE architecture ensures that card information remains private and
 * the random number generation for card shuffling is secure and tamper-proof.
 */
library CardLibrary {
    /**
     * @dev Card structure with value and suit
     * Values: 2-10 for numbered cards, 11=Jack, 12=Queen, 13=King, 14=Ace
     * Suits: 0=Hearts, 1=Diamonds, 2=Clubs, 3=Spades
     */
    struct Card {
        uint8 value; // 2-14
        uint8 suit;  // 0-3
    }
    
    /**
     * @dev Standard deck size constant, exposed as public for external use
     */
    uint8 public constant STANDARD_DECK_SIZE = 52;
    
    /**
     * @notice Initializes a standard 52-card deck
     * @return A memory array containing all 52 cards in order
     */
    function initializeDeck() internal pure returns (Card[] memory) {
        Card[] memory deck = new Card[](STANDARD_DECK_SIZE);
        uint8 index = 0;
        
        for (uint8 suit = 0; suit < 4; suit++) {
            for (uint8 value = 2; value <= 14; value++) {
                deck[index] = Card(value, suit);
                index++;
            }
        }
        
        return deck;
    }
    
    /**
     * @notice Shuffles a deck of cards using secure randomness
     * @dev Uses Fisher-Yates algorithm with TEN Network's secure RNG capabilities
     * When deployed on TEN, block.difficulty provides TEE-secured randomness
     * @param deck The deck to shuffle
     * @return A memory array containing the shuffled deck
     */
    function shuffleDeck(Card[] memory deck) internal view returns (Card[] memory) {
        // TEN Network provides secure randomness through block.difficulty
        uint256 seed = block.difficulty;
        
        for (uint256 i = STANDARD_DECK_SIZE - 1; i > 0; i--) {
            // Generate cryptographically secure random index
            uint256 j = uint256(keccak256(abi.encodePacked(seed, i))) % (i + 1);
            
            // Swap elements at indices i and j
            Card memory temp = deck[i];
            deck[i] = deck[j];
            deck[j] = temp;
        }
        
        return deck;
    }
    
    /**
     * @notice Compares two cards to determine which one is higher
     * @param card1 The first card to compare
     * @param card2 The second card to compare
     * @return True if card1 is higher than card2, false otherwise
     */
    function compareCards(Card memory card1, Card memory card2) internal pure returns (bool) {
        // Higher value card wins
        if (card1.value > card2.value) return true;
        if (card1.value < card2.value) return false;
        // If values are equal, higher suit wins
        return card1.suit > card2.suit;
    }
}