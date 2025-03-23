# OneCard Poker - Privacy-Enhanced Blockchain Card Game

OneCard Poker leverages the TEN Network's Trusted Execution Environment (TEE) technology to provide a truly private and fair poker experience on the blockchain.

## TEN Network Privacy Features

The TEN Network offers unique capabilities that make this poker game possible:

1. **Encrypted Private States**: Player cards and game data are stored in TEE-encrypted states, ensuring only authorized parties can access sensitive information.

2. **Secure Random Number Generation**: Card shuffling and dealing utilize TEN's secure RNG, which is tamper-proof and verifiably fair.

3. **Selective Information Disclosure**: Card information is only revealed to the appropriate players through TEN's privacy-preserving event system.

4. **Tamper-Proof Game Logic**: All game rules are enforced within the TEE, preventing manipulation or cheating.

## Contract Structure

The codebase is organized into multiple contracts for modularity and gas efficiency:

- **PokerCardLibrary.sol**: Card representations and deck operations
- **PokerGameLibrary.sol**: Game state definitions and bitmap operations
- **OneCard.sol**: Core game contract with gameplay functionality
- **SpectatorBetting.sol** (AI version only): Enhanced functionality for spectators

## Game Mechanics

OneCard Poker is a simplified poker variant where:

1. Each player receives a single card
2. Players can pay to peek at their card
3. After peeking, players can optionally pay to swap their card
4. Players place bets or fold during the betting round
5. The highest card wins the pot
6. At game end, all players' cards are publicly revealed

## Deployment Flow

When deploying to the TEN Network:

1. Deploy `PokerCardLibrary.sol` first
2. Deploy `PokerGameLibrary.sol`
3. Deploy `OneCard.sol`
4. Start the keeper service to manage game phase transitions

## Keeper Service

The keeper service is responsible for:

1. Monitoring game events and managing phase transitions
2. Ending the peek phase after the time limit expires
3. Ending the betting phase and initiating showdown
4. Cleaning up completed games

## Frontend Integration

### For Players

Players interact with the OneCard contract through these key functions:

- `createGame()` - Create a new game
- `joinGame(gameId)` - Join an existing game
- `peekAtCard(gameId)` - Pay to peek at your card
- `swapCard(gameId)` - Pay to swap your card
- `placeBet(gameId, betAmount)` - Place your bet
- `fold(gameId)` - Fold your hand

### Events to Listen For

- Game state events: `GameCreated`, `PeekPhaseStarted`, `BettingPhaseStarted`, etc.
- Card events: `CardPeeked` (private), `CardRevealed` (public)
- Player action events: `PlayerAction` (private)

### Card Revelation

The contract emits two types of card events:

1. **CardPeeked**: Private to the player who peeked (indexed by player address)
2. **CardRevealed**: Public event revealing cards at game end (visible to everyone)

The frontend should:
- Listen for `CardPeeked` events to show the player their own card
- Listen for `CardRevealed` events to show all cards at game end
- Call `getRevealedCards()` to get all cards when the game is in SHOWDOWN or ENDED state