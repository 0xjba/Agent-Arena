# One Card Poker Contracts

This folder contains the Solidity smart contracts for the Hidden One Card Poker game.

## Contract Structure

The codebase is split into multiple contracts to optimize deployment size and gas costs:

1. **Libraries**:
   - `PokerCardLibrary.sol` - Contains card representations and deck operations
   - `PokerGameLibrary.sol` - Contains game state definitions and bitmap operations

2. **Main Contract**:
   - `OneCard.sol` - The core game contract with all gameplay functionality

3. **View Contract**:
   - `PokerSpectatorView.sol` - A dedicated contract for spectator functionality

## Contract Improvements

### Buffer Periods for Phase Transitions
- 30-second buffer periods between major phase transitions
- Helps prevent front-running attacks when phases change
- Ensures all players have time to prepare for the next phase

### State Version/Nonce System
- Each game has a state version that increments on state changes
- Players have action nonces that increment with each action
- Action events include nonces for frontend sync and replay protection
- Helps prevent transaction reordering attacks

### Explicit State Checks for Card Operations
- Comprehensive validation for Monty Hall operations
- Ensures cards can only be revealed/swapped in valid states
- Prevents edge cases in card assignment and swapping

### Cleanup Safeguards
- Games are marked as "cleaned up" to prevent reuse
- Modifier prevents any action on cleaned-up games
- Improved state tracking for frontend UI
- Ensures game resources are properly released

## Deployment Order

When deploying these contracts, follow this order:

1. Deploy `PokerCardLibrary.sol` first
2. Deploy `PokerGameLibrary.sol`
3. Deploy `OneCard.sol` with the library addresses
4. Deploy `PokerSpectatorView.sol` with the main contract address

## Game Phases

1. **Registration**: Players join the game
2. **Peek Phase**: Players can peek at their cards and use Monty Hall
3. **Betting**: Players place bets or fold
4. **Showdown**: Cards are revealed and winner determined
5. **Ended**: Game is complete and can be cleaned up

## Frontend Integration

### For Players

Players should interact directly with the `OneCard` contract. Key functions:

- `joinGame(gameId)` - Join an existing game
- `peekAtCard(gameId)` - Pay to peek at your card
- `useMontyHallOption(gameId)` - Use the Monty Hall feature
- `montyHallDecision(gameId, swapCard)` - Decide to keep or swap your card
- `placeBet(gameId, betAmount)` - Place a bet
- `fold(gameId)` - Fold your hand

### For Spectators

Spectators should interact with the `PokerSpectatorView` contract. Key functions:

- `getActiveGames()` - Get all active games available for spectating
- `getGameStateForSpectating(gameId)` - Get comprehensive game state data
- `getRevealedCardsForSpectating(gameId)` - See all cards during showdown phase

### Events to Listen For

- `GameSpectatable` - Emitted when a new game is available for spectating
- `GameStateUpdated` - Emitted when game state changes (pot size, bet amounts, version)
- `BufferPeriodStarted` - Emitted when a phase transition buffer period begins
- `GameNoLongerSpectatable` - Emitted when a game is no longer available