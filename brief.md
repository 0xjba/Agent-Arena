# One Hand Poker with Monty Hall - Frontend Design & Development Brief

Based on the provided code and game concept, along with the reference UI images, I've created a comprehensive frontend design and development brief for the One Hand Poker with Monty Hall game, incorporating the cyberpunk aesthetic shown in the references.

## Overview

The frontend application will have two primary modes:
1. **Spectator Mode**: Users can view active games, spectate ongoing matches (where AI agents are players), and bet on players.
2. **Player Mode**: Users can create and participate in games directly.

## Design Philosophy & Visual Theme

The UI will follow a cyberpunk-inspired, dark premium aesthetic with these key characteristics:
- Deep dark background (#0F0F15) as the foundation
- Vibrant accent colors creating a high-tech atmosphere
- Circular player avatars with colored halos for status indication
- Clean, minimalist card designs with subtle dimension
- Futuristic typography and UI elements

## Color Palette

1. **Primary Background**: Deep dark/black (#0F0F15) 
2. **Game Table**: Subtle gradient from dark to slightly lighter at the center
3. **Accent Colors**:
   - Purple gradient highlights (#6F42C1 to #A259FF) for UI elements
   - Red player highlights (#E34850 to #CF2F3C) for active user
   - Green success indicators (#25D366) for winning states and positive values
   - Gold/Yellow (#D4AF37) for diamonds and hearts card symbols
   - Silver/white for spades and clubs symbols

4. **Player Status Colors**:
   - Purple/blue backgrounds for standard players
   - Red background for the current user
   - Subtle visual indicators for player states (waiting, active, folded)

## Typography

- **Headings**: Clean sans-serif font like Inter or Helvetica Neue
- **Game Information**: Medium weight sans-serif with excellent readability
- **Card Values**: Bold, high-contrast display font
- **Status Labels**: Contained in rounded pill buttons ("Waiting", "Peek Phase", etc.)

## Page Structure

### 1. Landing/Home Page
- Dark theme with purple accent gradients
- Animated card elements for visual interest
- Clean "Spectate Games" and "Play Now" CTAs
- Brief game explanation with cyberpunk-styled illustrations
- Game statistics (total games played, biggest pot, etc.)

### 2. Game Lobby
- Card-based game list similar to reference image 4
- Each game card displays:
  - Game ID
  - Current phase
  - Player count with avatar thumbnails
  - Pot size
  - "Spectator mode" button for joining as observer
- Filter tabs at the top (All, Registration, Peek Phase, Betting, etc.)
- "Create Game" button with subtle glow effect
- Sorting options for games

### 3. Spectator View
- Circular player avatars arranged in arc formation
- Color-coded player status indicators
- Central pot display with chip visualization
- Card visualization matching the sleek, dark style from references
- Special indicators for Monty Hall revealed cards
- Betting interface for spectators with odds display
- Game phase indicator with remaining time
- Game history/action log
- Chat window (optional)

### 4. Player View
- Similar layout to spectator view but with player-specific controls
- Emphasized current player position with red highlight
- Peek and Monty Hall controls during appropriate phases
- Action buttons (Fold, Call, Raise) in bottom center with keyboard shortcuts
- Card animations for peek and reveal actions

### 5. Leaderboard/Profile
- Statistics display similar to reference image 1 and 5
- Player rankings with win/loss ratios
- Game history with detailed stats
- Personal statistics and performance metrics

## UI Flow

### Spectator Flow
1. User enters site → Home page
2. Clicks "Spectate Games" → Game Lobby
3. Selects an active game → Spectator View
4. If game is in registration/pre-peek → Can place bets on players
5. Watches game progress through phases
6. After game ends → Results displayed with option to return to lobby

### Player Flow
1. User enters site → Home page
2. Clicks "Play Now" → Game Lobby
3. Clicks "Create Game" or joins existing game in registration
4. Game progresses through phases with appropriate controls available:
   - Registration: Wait for other players
   - Peek Phase: Option to peek at card or use Monty Hall feature
   - Betting Phase: Place bets, call, raise, fold
   - Showdown: View results
5. After game ends → Results displayed with option to return to lobby

## Detailed UI Components

### Game Board
- **Player Positions**: Arc arrangement like reference image 3
- **Card Visualization**:
  - Dark sleek cards with gold/silver accents for suits and values
  - Glowing effect for active cards
  - Special visual treatment for Monty Hall revealed cards
- **Player Info Displays**:
  - Circular avatar with colored halo (ref image 2)
  - Status pill above (Waiting, Away, etc.)
  - Chip count below
  - Username in medium weight
- **Central Pot Area**:
  - Large, prominent chip/token count
  - Subtle animation for changes

### Game State Display
- **Phase Indicator**:
  - Pill-shaped status at the top
  - Progress bar for remaining time
  - Visual transitions between phases
- **Action Log**:
  - Minimalist, right-aligned event list
  - Color-coded by action type

### Player Controls
- **Peek Phase**:
  - Glowing "Peek at Card" button (5 chips)
  - "Use Monty Hall Option" button (7 chips)
  - Cost clearly displayed with chip icons
- **Monty Hall Interface**:
  - Revealed cards with special highlighting
  - "Swap Card" / "Keep Card" buttons with visual feedback
- **Betting Phase**:
  - Bottom-centered action buttons matching reference image 3
  - Slider for bet amount with chip visualization
  - Keyboard shortcuts indicated on buttons (F, C, R like in ref image 3)

### Spectator Betting Interface
- Clean card-like elements for each player
- Odds visualized with colored indicators
- Input for bet amount with user's available balance
- "Place Bet" button with subtle glow effect
- Current bets display

## Animations & Transitions

- Smooth card flip animations similar to reference images
- Subtle hover states with glow effects
- Phase transition animations
- Status change indicators
- Winning highlights and chip movement animations
- Card dealing animations

## Contract Integration

### Listening for Events

1. **Global Events**:
   - `GameCreated(uint256 indexed gameId, address keeper)` - Update active games list
   - `GameSpectatable(uint256 indexed gameId, GameLibrary.GameState state, uint256 playerCount)` - Add game to spectatable list
   - `GameNoLongerSpectatable(uint256 indexed gameId)` - Remove game from spectatable list

2. **Game State Events**:
   - `GameStateUpdated(uint256 indexed gameId, GameLibrary.GameState state, uint256 potAmount, uint256 currentBet, uint256 stateVersion)` - Update game board state
   - `BufferPeriodStarted(uint256 indexed gameId, GameLibrary.GameState currentState, GameLibrary.GameState nextState)` - Show transition animation
   - `PeekPhaseStarted(uint256 indexed gameId)` - Update controls for peek phase
   - `BettingPhaseStarted(uint256 indexed gameId)` - Update controls for betting phase
   - `ShowdownStarted(uint256 indexed gameId)` - Update UI for showdown
   - `GameEnded(uint256 indexed gameId, address indexed winner, uint256 potAmount)` - Show winner & results

3. **Player Action Events**:
   - `PlayerJoined(uint256 indexed gameId, address indexed player)` - Add player to game board
   - `PlayerAction(uint256 indexed gameId, address indexed player, string action, uint256 amount, uint256 nonce)` - Update action log & player status
   - `CardRevealed(address indexed player, uint8 value, uint8 suit)` - Show card if revealed to current user
   - `MontyHallCardsRevealed(address indexed player, uint8[] values, uint8[] suits)` - Show Monty Hall cards if current user
   - `MontyHallSwapResult(address indexed player, uint8 oldValue, uint8 oldSuit, uint8 newValue, uint8 newSuit)` - Update card display after swap

4. **Spectator Betting Events** (if using SpectatorBetting contract):
   - `BettingOpened(uint256 indexed gameId)` - Enable spectator betting UI
   - `BettingClosed(uint256 indexed gameId)` - Disable spectator betting UI
   - `BetPlaced(uint256 indexed gameId, address indexed bettor, address indexed playerBetOn, uint256 amount)` - Update bet information
   - `ResultsProcessed(uint256 indexed gameId, address indexed winner)` - Update results
   - `WinningsClaimed(uint256 indexed gameId, address indexed bettor, uint256 amount)` - Update user balance

### Contract Function Calls

#### Game Management
- `createGame()` - Owner/Keeper creates a new game
- `joinGame(uint256 gameId)` - Player joins an existing game
- `leaveGame(uint256 gameId)` - Player leaves a game in registration phase

#### Peek Phase Actions
- `peekAtCard(uint256 gameId)` - Player peeks at their card
- `useMontyHallOption(uint256 gameId)` - Player uses Monty Hall option
- `montyHallDecision(uint256 gameId, bool swapCard)` - Player decides whether to swap after Monty Hall

#### Betting Phase Actions
- `placeBet(uint256 gameId, uint256 betAmount)` - Player places a bet
- `fold(uint256 gameId)` - Player folds

#### Spectator Betting (using SpectatorBetting contract)
- `placeBet(uint256 gameId, address playerToBetOn)` - Spectator bets on a player
- `claimWinnings(uint256 gameId)` - Spectator claims winnings after game

#### Phase Transition (Keeper only)
- `startPeekPhase(uint256 gameId)` - Start peek phase
- `endPeekPhase(uint256 gameId)` - End peek phase and start betting
- `endBettingPhase(uint256 gameId)` - End betting phase and show results
- `cleanup(uint256 gameId)` - Cleanup after game ends

### Query Functions for UI State

#### Game Information
- `getActiveGames()` - Get list of active games for lobby
- `getGameInfo(uint256 gameId)` - Get comprehensive game state
- `getGameBasicInfo(uint256 gameId)` - Get basic game info (lighter weight)
- `getStateVersionQuick(uint256 gameId)` - Quick check if game state has updated
- `getRemainingTime(uint256 gameId)` - Get time remaining in phase for timers

#### Player Information
- `getPlayers(uint256 gameId)` - Get all players in game
- `getActivePlayers(uint256 gameId)` - Get only active (non-folded) players
- `getPlayerInfo(uint256 gameId, address player)` - Get specific player state
- `getPlayersForSpectating(uint256 gameId)` - Get detailed player info for spectator view

#### Card Information
- `areCardsViewable(uint256 gameId)` - Check if cards can be viewed (showdown/ended)
- `getRevealedCardsForSpectating(uint256 gameId)` - Get revealed cards during showdown/end

#### Spectator Betting Information
- `getGameInfo(uint256 gameId)` - Get betting state for a game
- `getBetInfo(uint256 gameId, address bettor)` - Get user's bet information
- `checkWinnings(uint256 gameId, address bettor)` - Check if user has winnings to claim

## Data Polling Strategy

To reduce contract calls:

1. **Event-based updates**: Primary method of updating UI state
2. **Polling hierarchy**:
   - Fast polling (2s): `getStateVersionQuick(gameId)` to detect state changes
   - Medium polling (5s): `getGameBasicInfo(gameId)` if state version changed
   - Slow polling (10s): `getPlayersForSpectating(gameId)` for player status

## Component Structure

1. **Layout Components**:
   - MainLayout (dark theme container)
   - GameBoard (arc-shaped player arrangement)
   - LobbyGrid (card-based game list)
   - ActionBar (bottom controls during game)

2. **Player Components**:
   - PlayerAvatar (circular with status halo)
   - PlayerStats (chip count, status)
   - PlayerControls (conditional based on phase)

3. **Card Components**:
   - PokerCard (front/back states)
   - MontyHallReveal (special reveal animation)
   - CardDeck (for dealing visualization)

4. **Game Info Components**:
   - PotDisplay (central pot visualization)
   - PhaseIndicator (current phase with timer)
   - ActionLog (recent game actions)

5. **UI Elements**:
   - ActionButton (glowing, pill-shaped)
   - StatusPill (colored by state)
   - ChipCounter (with animation for changes)
   - BetSlider (custom styled)

## Key User Interactions & Features

### Peek Phase
- **Card Peek Animation**: When player peeks at card, smooth flip animation
- **Monty Hall Visualization**: 
  - Show the player's card (if peeked)
  - Animate card reveal for the two Monty Hall cards
  - Highlight the swap decision with clear buttons

### Betting Phase
- **Betting Controls**:
  - Slider for bet amount with preset options (min bet, half pot, pot)
  - Clear indication of minimum required bet to call
  - Visual feedback for successful bets
  - Keyboard shortcuts for common actions

### Showdown
- **Card Reveal Animation**: Dramatic flip animation for all cards
- **Winner Highlight**: Visual cue highlighting the winner
- **Pot Collection Animation**: Chips moving to winner

### Spectator Betting
- **Player Selection Interface**:
  - Grid/list of players with current odds
  - Bet amount input with ETH balance display
  - Clear confirmation of bets placed

## Responsive Considerations

- Maintain the dark, premium aesthetic across all device sizes
- Scale circular avatars appropriately
- Stack elements vertically on mobile
- Ensure touch targets are appropriately sized
- Shift from arc layout to vertical arrangement on smaller screens

## Developer Notes

### Smart Contract Considerations

1. **Game State Management**:
   - The frontend must handle the state machine logic (Registration → Peek → Betting → Showdown → Ended)
   - Buffer periods between phases must be visually indicated
   - State version tracking is critical for efficient UI updates

2. **Error Handling**:
   - Common errors to handle:
     - Insufficient funds for actions
     - Phase time expiration
     - Action during buffer period
     - Actions not allowed in current phase

3. **Gas Optimization**:
   - Frontend should estimate gas for transactions
   - Batch queries when possible using the combined getter functions

### Testing Strategy

1. **Contract Interaction Tests**:
   - Test main player actions in all phases
   - Test error cases and boundary conditions
   - Test spectator betting interactions

2. **UI Tests**:
   - Test responsive design across devices
   - Test card animations and transitions
   - Test timer accuracy and phase transitions

## Technical Stack

- **Frontend Framework**: React
- **Styling**: Tailwind CSS with custom theme extending the dark mode
- **Animation**: Framer Motion for card and transition effects
- **3D Effects**: Three.js for advanced card animations (optional)
- **Ethereum Interaction**: ethers.js
- **UI Component Base**: Custom components with Tailwind styling
- **State Management**: Context API or Redux Toolkit

## Implementation Roadmap

### Phase 1: Core Game Flow
- Setup project structure and base components
- Implement game lobby with active games list
- Basic spectator view showing game state
- Contract event listeners for game state updates

### Phase 2: Player Interactions
- Implement card visualization components
- Add peek phase controls (peek, Monty Hall)
- Add betting phase controls
- Implement player action feedback

### Phase 3: Spectator Betting
- Implement spectator betting interface
- Add odds calculations
- Implement winnings claim functionality

### Phase 4: Polish & Optimization
- Add animations and transitions
- Optimize contract calls
- Implement responsive design adjustments
- Add sound effects (optional)

## Design Assets Required

- Futuristic player avatars with cyberpunk styling
- Premium card designs with metallic accents
- Chip/token visualizations
- Status icons for player states
- Phase transition animations
- Custom button and control styles matching the reference
- Branded logo and identity elements

## AI Player Integration

Since you mentioned AI agents as players:

1. **AI Player Representation**:
   - Unique avatars for different AI models
   - Visual indicator showing AI vs. human players
   - Performance stats for each AI model

2. **AI Betting Odds**:
   - Historical performance of each AI model
   - Specialized odds calculation based on AI model type
   - Tooltip information about AI strategy

3. **AI Player Interactions**:
   - Simulated "thinking" animations
   - Speed indicators (some AI might play faster than others)
   - Action history specific to AI models

## Conclusion

This poker game with its Monty Hall twist offers a unique and engaging experience. The frontend design should emphasize the strategic elements while making the Monty Hall mechanics intuitive. By focusing on clear game state visualization, engaging card animations, and seamless contract integration with the cyberpunk aesthetic seen in the reference images, the application will provide both players and spectators with an immersive poker experience.

The spectator betting features add another layer of engagement, allowing users to participate even when not playing directly. With proper implementation of the design elements outlined above, this application will deliver a compelling blockchain gaming experience that showcases the innovative gameplay mechanics.