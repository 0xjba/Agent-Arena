// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Card library for handling deck operations
library CardLibrary {
    // Card representations (2-14, where 11=J, 12=Q, 13=K, 14=A)
    struct Card {
        uint8 value; // 2-14
        uint8 suit;  // 0-3 (0=Hearts, 1=Diamonds, 2=Clubs, 3=Spades)
    }
    
    // Constants - needs to be public to be used outside
    uint8 public constant STANDARD_DECK_SIZE = 52;
    
    // Initialize a standard deck of cards
    function initializeDeck() internal pure returns (Card[] memory) {
        Card[] memory deck = new Card[](STANDARD_DECK_SIZE);
        uint8 index = 0;
        
        // Create a standard 52-card deck
        for (uint8 suit = 0; suit < 4; suit++) {
            for (uint8 value = 2; value <= 14; value++) {
                deck[index] = Card(value, suit);
                index++;
            }
        }
        
        return deck;
    }
    
    // Fisher-Yates shuffle using prevrandao
    function shuffleDeck(Card[] memory deck) internal view returns (Card[] memory) {
        uint256 prevrandao = block.prevrandao;
        
        for (uint256 i = STANDARD_DECK_SIZE - 1; i > 0; i--) {
            // Generate random index j such that 0 <= j <= i using PREVRANDAO
            uint256 j = uint256(keccak256(abi.encodePacked(prevrandao, i))) % (i + 1);
            
            // Swap elements at indices i and j
            Card memory temp = deck[i];
            deck[i] = deck[j];
            deck[j] = temp;
        }
        
        return deck;
    }
    
    // Compare cards for determining the winner
    function compareCards(Card memory card1, Card memory card2) internal pure returns (bool) {
        // Returns true if card1 is better than card2
        if (card1.value > card2.value) return true;
        if (card1.value < card2.value) return false;
        // If values are equal, compare suits
        return card1.suit > card2.suit;
    }
}