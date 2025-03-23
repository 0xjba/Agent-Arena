const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// Configure logging
const logPath = path.join(__dirname, "one-card-poker-test.txt");
let logStream = fs.createWriteStream(logPath, { flags: "a" });

function log(message) {
  const timestamp = new Date().toISOString();
  const formattedMessage = `[${timestamp}] ${message}\n`;
  logStream.write(formattedMessage);
  console.log(message);
}

// Card helper functions
function getCardValueName(value) {
  if (value >= 2 && value <= 10) return value.toString();
  if (value === 11) return "Jack";
  if (value === 12) return "Queen";
  if (value === 13) return "King";
  if (value === 14) return "Ace";
  return "Unknown";
}

function getCardSuitName(suit) {
  const suits = ["Hearts", "Diamonds", "Clubs", "Spades"];
  return suits[suit] || "Unknown";
}

function formatCard(value, suit) {
  return `${getCardValueName(value)} of ${getCardSuitName(suit)}`;
}

// Format ETH values for display
function formatEth(weiValue) {
  return ethers.utils.formatEther(weiValue);
}

// GameState enum mapping from PokerGameLibrary
const GameState = {
  0: "REGISTRATION",
  1: "PEEK_PHASE",
  2: "BETTING",
  3: "SHOWDOWN",
  4: "ENDED"
};

// Function to set up wallets from .env file
async function setupWallets(provider) {
  const wallets = [];
  
  // Check for required environment variables
  if (!process.env.OWNER_PRIVATE_KEY) {
    throw new Error("OWNER_PRIVATE_KEY is required in .env file");
  }
  
  // Owner wallet
  const ownerWallet = new ethers.Wallet(process.env.OWNER_PRIVATE_KEY, provider);
  wallets.push(ownerWallet);
  
  // Player wallets
  for (let i = 1; i <= 4; i++) {
    const privateKeyVar = `PLAYER${i}_PRIVATE_KEY`;
    if (!process.env[privateKeyVar]) {
      throw new Error(`${privateKeyVar} is required in .env file`);
    }
    const playerWallet = new ethers.Wallet(process.env[privateKeyVar], provider);
    wallets.push(playerWallet);
  }
  
  // Add spectator wallets
  const spectatorWallets = [];
  for (let i = 1; i <= 3; i++) {
    const privateKeyVar = `SPECTATOR${i}_PRIVATE_KEY`;
    if (!process.env[privateKeyVar]) {
      throw new Error(`${privateKeyVar} is required in .env file`);
    }
    const spectatorWallet = new ethers.Wallet(process.env[privateKeyVar], provider);
    spectatorWallets.push(spectatorWallet);
  }
  
  // Keeper wallet (if different from owner)
  if (process.env.KEEPER_PRIVATE_KEY && process.env.KEEPER_PRIVATE_KEY !== process.env.OWNER_PRIVATE_KEY) {
    const keeperWallet = new ethers.Wallet(process.env.KEEPER_PRIVATE_KEY, provider);
    wallets.push(keeperWallet);
  }
  
  return { mainWallets: wallets, spectatorWallets };
}

describe("One Card Poker with Monty Hall and Spectator Betting Test", function() {
  // Increase timeout for TEN network interactions
  this.timeout(600000); // 10 minutes

  let cardLibrary;
  let gameLibrary;
  let pokerContract;
  let spectatorContract;
  let spectatorBettingContract;
  let owner;
  let keeper;
  let players = [];
  let spectators = [];
  let gameId;
  let playerCards = {};
  
  // Transaction options with higher gas settings
  const txOptions = {
    gasLimit: 2000000 // Increased for regular transactions
  };

  const highGasTxOptions = {
    gasLimit: 5000000 // Increased for complex operations
  };

  const veryHighGasTxOptions = {
    gasLimit: 15000000 // Significantly increased for very complex operations
  };

  const extremeGasTxOptions = {
    gasLimit: 30000000 // For the most gas-intensive operations like contract deployment
  };

  before(async function() {
    log("\n===== SETTING UP TEST ENVIRONMENT =====");
    
    // Set up wallets from .env
    const provider = ethers.provider;
    const { mainWallets, spectatorWallets } = await setupWallets(provider);
    
    // First wallet is owner
    owner = mainWallets[0];
    
    // Player wallets (next 4)
    players = mainWallets.slice(1, 5);
    
    // Spectator wallets
    spectators = spectatorWallets;
    
    // Keeper is either a separate wallet or same as owner
    keeper = mainWallets.length > 5 ? mainWallets[5] : owner;
    
    log("Wallet setup complete.");
    log(`Owner address: ${owner.address}`);
    players.forEach((player, index) => {
      log(`Player ${index + 1} address: ${player.address}`);
    });
    spectators.forEach((spectator, index) => {
      log(`Spectator ${index + 1} address: ${spectator.address}`);
    });
    log(`Keeper address: ${keeper.address}`);
    
    // Check wallet balances
    log("\n----- CHECKING WALLET BALANCES -----");
    for (const wallet of [owner, ...players, ...spectators, keeper]) {
      const balance = await wallet.getBalance();
      const ethBalance = ethers.utils.formatEther(balance);
      log(`Address ${wallet.address} has ${ethBalance} ETH`);
      
      // Warn if balance is too low
      if (parseFloat(ethBalance) < 0.01) {
        log(`WARNING: Address ${wallet.address} has low balance. Please fund with ETH.`);
      }
    }
    
    // Check if contracts are already deployed
    if (process.env.POKER_CONTRACT_ADDRESS && 
        process.env.SPECTATOR_CONTRACT_ADDRESS &&
        process.env.SPECTATOR_BETTING_ADDRESS) {
      
      log(`\nUsing existing contracts:`);
      log(`OneCard: ${process.env.POKER_CONTRACT_ADDRESS}`);
      log(`PokerSpectatorView: ${process.env.SPECTATOR_CONTRACT_ADDRESS}`);
      log(`SpectatorBetting: ${process.env.SPECTATOR_BETTING_ADDRESS}`);

      // Get factories for contracts
      const PokerFactory = await ethers.getContractFactory("OneCard");
      const SpectatorFactory = await ethers.getContractFactory("PokerSpectatorView");
      const BettingFactory = await ethers.getContractFactory("SpectatorBetting");

      // Attach to existing contracts
      pokerContract = PokerFactory.attach(process.env.POKER_CONTRACT_ADDRESS);
      spectatorContract = SpectatorFactory.attach(process.env.SPECTATOR_CONTRACT_ADDRESS);
      spectatorBettingContract = BettingFactory.attach(process.env.SPECTATOR_BETTING_ADDRESS);
    } else {
      // Deploy contracts from scratch
      log("\n----- DEPLOYING CONTRACTS -----");
      
      // First, deploy CardLibrary
      log("Deploying CardLibrary...");
      const CardLibraryFactory = await ethers.getContractFactory("CardLibrary");
      cardLibrary = await CardLibraryFactory.connect(owner).deploy();
      await cardLibrary.deployed();
      log(`CardLibrary deployed at: ${cardLibrary.address}`);

      // Next, deploy GameLibrary
      log("Deploying GameLibrary...");
      const GameLibraryFactory = await ethers.getContractFactory("GameLibrary");
      gameLibrary = await GameLibraryFactory.connect(owner).deploy();
      await gameLibrary.deployed();
      log(`GameLibrary deployed at: ${gameLibrary.address}`);

      // Deploy main contract (no explicit library linking)
      log("Deploying OneCard main contract...");
      const PokerFactory = await ethers.getContractFactory("OneCard");
      pokerContract = await PokerFactory.connect(owner).deploy();
      await pokerContract.deployed();
      log(`OneCard contract deployed at: ${pokerContract.address}`);

      // Deploy spectator contract
      log("Deploying PokerSpectatorView contract...");
      const SpectatorFactory = await ethers.getContractFactory("PokerSpectatorView");
      spectatorContract = await SpectatorFactory.connect(owner).deploy(pokerContract.address);
      await spectatorContract.deployed();
      log(`PokerSpectatorView contract deployed at: ${spectatorContract.address}`);
      
      // Deploy spectator betting contract
      log("Deploying SpectatorBetting contract...");
      const BettingFactory = await ethers.getContractFactory("SpectatorBetting");
      spectatorBettingContract = await BettingFactory.connect(owner).deploy(pokerContract.address);
      await spectatorBettingContract.deployed();
      log(`SpectatorBetting contract deployed at: ${spectatorBettingContract.address}`);
      
      // Set the spectator betting contract in the poker contract
      log("Setting spectator betting contract in OneCard contract...");
      const setBettingTx = await pokerContract.connect(owner).setSpectatorBettingContract(spectatorBettingContract.address, txOptions);
      await setBettingTx.wait();
      log(`SpectatorBetting contract set in OneCard`);
      
      // Log deployment addresses for future use
      log("\nAdd these to your .env file for future use:");
      log(`POKER_CONTRACT_ADDRESS=${pokerContract.address}`);
      log(`SPECTATOR_CONTRACT_ADDRESS=${spectatorContract.address}`);
      log(`SPECTATOR_BETTING_ADDRESS=${spectatorBettingContract.address}`);
    }
  });
  
  it("Should play a complete game of One Card Poker with Monty Hall and Spectator Betting", async function() {
    log("\n===== STARTING ONE CARD POKER WITH MONTY HALL AND SPECTATOR BETTING TEST =====");
    
    // Add keeper if different from owner
    if (keeper.address !== owner.address) {
      log("\n----- ADDING KEEPER -----");
      const addKeeperTx = await pokerContract.connect(owner).addKeeper(keeper.address, txOptions);
      await addKeeperTx.wait();
      log(`Added ${keeper.address} as a keeper`);
    }
    
    // Add players to whitelist
    log("\n----- ADDING PLAYERS TO WHITELIST -----");
    const playerAddresses = players.map(player => player.address);
    const tx = await pokerContract.connect(owner).addMultipleToWhitelist(playerAddresses, highGasTxOptions);
    await tx.wait();
    log(`Added ${players.length} players to whitelist`);
    
    // Create a new game
    log("\n----- CREATING A NEW GAME -----");
    const createTx = await pokerContract.connect(keeper).createGame(veryHighGasTxOptions);
    const createReceipt = await createTx.wait();
    
    // Extract gameId from the event logs
    const gameCreatedEvent = createReceipt.events.find(e => e.event === "GameCreated");
    gameId = gameCreatedEvent.args.gameId.toNumber();
    log(`Created Game with ID: ${gameId}`);
    
    // Set up event listeners for SpectatorBetting
    spectatorBettingContract.on("BettingOpened", (gameIdEvent) => {
      if (gameIdEvent.toString() === gameId.toString()) {
        log(`Betting opened for game ${gameId}`);
      }
    });
    
    spectatorBettingContract.on("BetPlaced", (gameIdEvent, bettor, playerBetOn, amount) => {
      if (gameIdEvent.toString() === gameId.toString()) {
        log(`Spectator ${bettor} placed a bet of ${formatEth(amount)} ETH on player ${playerBetOn}`);
      }
    });
    
    spectatorBettingContract.on("BettingClosed", (gameIdEvent) => {
      if (gameIdEvent.toString() === gameId.toString()) {
        log(`Betting closed for game ${gameId}`);
      }
    });
    
    spectatorBettingContract.on("ResultsProcessed", (gameIdEvent, winner) => {
      if (gameIdEvent.toString() === gameId.toString()) {
        log(`Betting results processed for game ${gameId}, winner: ${winner}`);
      }
    });
    
    spectatorBettingContract.on("WinningsClaimed", (gameIdEvent, bettor, amount) => {
      if (gameIdEvent.toString() === gameId.toString()) {
        log(`Spectator ${bettor} claimed ${formatEth(amount)} ETH in winnings`);
      }
    });
    
    // Get the game info to see if players were automatically added
    const playersInGame = await pokerContract.getPlayers(gameId);
    log(`Initial players in game: ${playersInGame.length}`);
    for (let i = 0; i < playersInGame.length; i++) {
      log(`Player ${i+1}: ${playersInGame[i]}`);
    }
    
    // If not all players are in, have them join
    if (playersInGame.length < players.length) {
      log("\n----- ADDING REMAINING PLAYERS TO GAME -----");
      for (let i = 0; i < players.length; i++) {
        const playerInGame = playersInGame.some(addr => 
          addr.toLowerCase() === players[i].address.toLowerCase());
        
        if (!playerInGame) {
          const joinTx = await pokerContract.connect(players[i]).joinGame(gameId, txOptions);
          await joinTx.wait();
          log(`Player ${i+1} (${players[i].address}) joined the game`);
        }
      }
    }
    
    // Verify game info before spectator betting
    log("\n----- VERIFYING GAME INFO BEFORE SPECTATOR BETTING -----");
    const gameInfo = await pokerContract.getGameInfo(gameId);
    log(`Game state: ${GameState[gameInfo.state]}`);
    log(`Player count: ${gameInfo.playerCount.toString()}`);
    log(`Active count: ${gameInfo.activeCount.toString()}`);
    log(`Game keeper: ${gameInfo.gameKeeper}`);
    log(`State version: ${gameInfo.stateVersion.toString()}`);
    log(`Is cleaned up: ${gameInfo.isCleanedUp}`);
    
    // Check if betting is open
    log("\n----- CHECKING IF BETTING IS OPEN -----");
    const bettingInfo = await spectatorBettingContract.getGameInfo(gameId);
    log(`Betting open: ${bettingInfo.bettingOpen}`);
    log(`Results processed: ${bettingInfo.resultsProcessed}`);
    log(`Total bet amount: ${formatEth(bettingInfo.totalBetAmount)} ETH`);
    
    // Spectators place bets on different players
    log("\n----- SPECTATORS PLACING BETS -----");
    try {
      // Each spectator bets on a different player
      for (let i = 0; i < spectators.length; i++) {
        // Choose a player to bet on (different for each spectator)
        const playerToBetOn = players[i % players.length].address;
        
        // Place the bet with 0.01 ETH
        const betAmount = ethers.utils.parseEther("0.01");
        const betTx = await spectatorBettingContract.connect(spectators[i]).placeBet(
          gameId, 
          playerToBetOn, 
          { ...txOptions, value: betAmount }
        );
        
        await betTx.wait();
        log(`Spectator ${i+1} (${spectators[i].address}) bet ${formatEth(betAmount)} ETH on Player ${(i % players.length) + 1} (${playerToBetOn})`);
        
        // Get bet info to verify
        const betInfo = await spectatorBettingContract.getBetInfo(gameId, spectators[i].address);
        log(`Verified bet - Player: ${betInfo.playerBetOn}, Amount: ${formatEth(betInfo.amount)} ETH, Claimed: ${betInfo.claimed}`);
      }
      
      // Check total bets on each player
      log("\n----- CHECKING TOTAL BETS ON EACH PLAYER -----");
      for (let i = 0; i < players.length; i++) {
        const totalBet = await spectatorBettingContract.getTotalBetOnPlayer(gameId, players[i].address);
        log(`Total bet on Player ${i+1} (${players[i].address}): ${formatEth(totalBet)} ETH`);
      }
      
      // Get updated betting info
      const updatedBettingInfo = await spectatorBettingContract.getGameInfo(gameId);
      log(`Total betting pool: ${formatEth(updatedBettingInfo.totalBetAmount)} ETH`);
    } catch (error) {
      log(`Error during spectator betting: ${error.message}`);
    }
    
    // Start the peek phase
    log("\n----- STARTING PEEK PHASE -----");
    try {
      const startPeekTx = await pokerContract.connect(keeper).startPeekPhase(gameId, veryHighGasTxOptions);
      log("startPeekPhase transaction submitted, waiting for confirmation...");
      const startPeekReceipt = await startPeekTx.wait();
      log("startPeekPhase transaction confirmed!");
      
      // Look for the buffer period event
      const bufferEvent = startPeekReceipt.events.find(e => e.event === "BufferPeriodStarted");
      if (bufferEvent) {
        log(`Buffer period started before peek phase. Current state: ${GameState[bufferEvent.args.currentState]}, Next state: ${GameState[bufferEvent.args.nextState]}`);
      }
      
      const peekPhaseEvent = startPeekReceipt.events.find(e => e.event === "PeekPhaseStarted");
      if (peekPhaseEvent) {
        log(`Peek phase started for game ${gameId}`);
      } else {
        log("WARNING: PeekPhaseStarted event not found in logs");
      }
      
      // Get the state update event to check state version
      const stateUpdateEvent = startPeekReceipt.events.find(e => e.event === "GameStateUpdated");
      if (stateUpdateEvent) {
        log(`Game state updated: State=${GameState[stateUpdateEvent.args.state]}, Pot=${stateUpdateEvent.args.potAmount}, CurrentBet=${stateUpdateEvent.args.currentBet}, StateVersion=${stateUpdateEvent.args.stateVersion}`);
      }
      
      // Check if betting is now closed
      const bettingInfoAfterPeek = await spectatorBettingContract.getGameInfo(gameId);
      log(`Betting open after peek phase start: ${bettingInfoAfterPeek.bettingOpen}`);
      
      // Get updated game info with phase end time and buffer end time
      const updatedGameInfo = await pokerContract.getGameInfo(gameId);
      log(`Phase end time: ${new Date(updatedGameInfo.phaseEndTime * 1000).toISOString()}`);
      log(`Buffer end time: ${new Date(updatedGameInfo.bufferEndTime * 1000).toISOString()}`);
      
      // Check if we need to wait for buffer period
      const currentTime = Math.floor(Date.now() / 1000);
      const bufferWaitTime = updatedGameInfo.bufferEndTime - currentTime;
      
      if (bufferWaitTime > 0) {
        log(`Waiting ${bufferWaitTime} seconds for buffer period to end...`);
        
        // On TEN network, we must wait
        if (network.name === "ten") {
          log("Waiting for buffer period to end on TEN network...");
          
          // Wait until buffer period ends
          while (Math.floor(Date.now() / 1000) < updatedGameInfo.bufferEndTime) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            const remaining = updatedGameInfo.bufferEndTime - Math.floor(Date.now() / 1000);
            if (remaining > 0 && remaining % 10 === 0) {
              log(`${remaining} seconds remaining in buffer period`);
            }
          }
          log("Buffer period ended");
        } else {
          // On local network, we can advance time
          await ethers.provider.send("evm_increaseTime", [bufferWaitTime + 5]);
          await ethers.provider.send("evm_mine");
          log("Time advanced past buffer period");
        }
      }
    } catch (error) {
      log(`Error starting peek phase: ${error.message}`);
      throw error;
    }
    
    // Set up event listener for CardRevealed events
    pokerContract.on("CardRevealed", async (player, value, suit) => {
      const cardString = formatCard(Number(value), Number(suit));
      playerCards[player] = { value, suit, cardString };
      log(`Card for ${player}: ${cardString}`);
    });
    
    // Set up event listener for MontyHall events
    pokerContract.on("MontyHallCardsRevealed", async (player, values, suits) => {
      log(`Monty Hall cards revealed to ${player}:`);
      for (let i = 0; i < values.length; i++) {
        log(`- ${formatCard(Number(values[i]), Number(suits[i]))}`);
      }
    });
    
    pokerContract.on("MontyHallSwapResult", async (player, oldValue, oldSuit, newValue, newSuit) => {
      log(`${player} swapped ${formatCard(Number(oldValue), Number(oldSuit))} for ${formatCard(Number(newValue), Number(newSuit))}`);
      playerCards[player] = { value: newValue, suit: newSuit, cardString: formatCard(Number(newValue), Number(newSuit)) };
    });
    
    // Players take actions in the peek phase
    log("\n----- PLAYERS PEEKING AT CARDS -----");
    // Store initial chip balances for comparison later
    const initialChipBalances = {};
    
    // First two players will peek at their cards
    for (let i = 0; i < 2; i++) {
      const player = players[i];
      try {
        // Get initial chip balance
        const playerInfoBefore = await pokerContract.getPlayerInfo(gameId, player.address);
        initialChipBalances[player.address] = playerInfoBefore.chipBalance;
        log(`Player ${i+1} initial chip balance: ${playerInfoBefore.chipBalance}`);
        
        const peekTx = await pokerContract.connect(player).peekAtCard(gameId, highGasTxOptions);
        const peekReceipt = await peekTx.wait();
        log(`Player ${i+1} (${player.address}) peeked at their card`);
        
        // Look for PlayerAction event with nonce
        const playerActionEvent = peekReceipt.events.find(e => e.event === "PlayerAction");
        if (playerActionEvent) {
          log(`Player action: ${playerActionEvent.args.action}, Amount: ${playerActionEvent.args.amount}, Nonce: ${playerActionEvent.args.nonce}`);
        }
        
        // Get chip balance after peeking
        const playerInfoAfter = await pokerContract.getPlayerInfo(gameId, player.address);
        log(`Player ${i+1} chip balance after peeking: ${playerInfoAfter.chipBalance}`);
      } catch (error) {
        log(`Error when Player ${i+1} tried to peek: ${error.message}`);
      }
    }
    
    // Next player will use Monty Hall option
    log("\n----- PLAYER USING MONTY HALL OPTION -----");
    const montyHallPlayer = players[2];
    try {
      // Get initial chip balance
      const playerInfoBefore = await pokerContract.getPlayerInfo(gameId, montyHallPlayer.address);
      initialChipBalances[montyHallPlayer.address] = playerInfoBefore.chipBalance;
      log(`Player 3 initial chip balance: ${playerInfoBefore.chipBalance}`);
      
      const montyHallTx = await pokerContract.connect(montyHallPlayer).useMontyHallOption(gameId, highGasTxOptions);
      const montyHallReceipt = await montyHallTx.wait();
      log(`Player 3 (${montyHallPlayer.address}) used Monty Hall option`);
      
      // Look for PlayerAction event with nonce
      const playerActionEvent = montyHallReceipt.events.find(e => e.event === "PlayerAction");
      if (playerActionEvent) {
        log(`Player action: ${playerActionEvent.args.action}, Amount: ${playerActionEvent.args.amount}, Nonce: ${playerActionEvent.args.nonce}`);
      }
      
      // Get chip balance after using Monty Hall
      const playerInfoAfter = await pokerContract.getPlayerInfo(gameId, montyHallPlayer.address);
      log(`Player 3 chip balance after using Monty Hall: ${playerInfoAfter.chipBalance}`);
      
      // Decide to swap the card
      const swapTx = await pokerContract.connect(montyHallPlayer).montyHallDecision(gameId, true, highGasTxOptions);
      const swapReceipt = await swapTx.wait();
      log(`Player 3 decided to swap their card`);
      
      // Look for PlayerAction event with nonce
      const swapActionEvent = swapReceipt.events.find(e => e.event === "PlayerAction");
      if (swapActionEvent) {
        log(`Player action: ${swapActionEvent.args.action}, Amount: ${swapActionEvent.args.amount}, Nonce: ${swapActionEvent.args.nonce}`);
      }
    } catch (error) {
      log(`Error when Player 3 tried to use Monty Hall option: ${error.message}`);
    }
    
    // Last player will do nothing (blind play)
    log(`Player 4 (${players[3].address}) chose not to peek or use Monty Hall`);
    initialChipBalances[players[3].address] = (await pokerContract.getPlayerInfo(gameId, players[3].address)).chipBalance;
    
    // Log all player actions and chip balances after peek phase
    log("\n----- PLAYER STATUS AFTER PEEK PHASE -----");
    for (let i = 0; i < players.length; i++) {
      try {
        const playerInfo = await pokerContract.getPlayerInfo(gameId, players[i].address);
        log(`Player ${i+1} (${players[i].address}):`);
        log(`  Chip balance: ${playerInfo.chipBalance}`);
        log(`  Has peeked: ${playerInfo.hasPeeked}`);
        log(`  Used Monty Hall: ${playerInfo.usedMontyHall}`);
        log(`  Action nonce: ${playerInfo.actionNonce.toString()}`);
      } catch (error) {
        log(`Error getting info for Player ${i+1}: ${error.message}`);
      }
    }
    
    // Wait for peek phase to end
    log("\n----- WAITING FOR PEEK PHASE TO END -----");
    const peekGameInfo = await pokerContract.getGameInfo(gameId);
    const currentTime = Math.floor(Date.now() / 1000);
    const peekPhaseWaitTime = peekGameInfo.phaseEndTime - currentTime;
    
    if (peekPhaseWaitTime > 0) {
      log(`Waiting ${peekPhaseWaitTime} seconds for peek phase to end...`);
      
      // On TEN network, we must wait
      if (network.name === "ten") {
        log("Waiting for peek phase to end on TEN network...");
        
        // Wait until peek phase ends
        while (Math.floor(Date.now() / 1000) < peekGameInfo.phaseEndTime) {
          await new Promise(resolve => setTimeout(resolve, 10000));
          const remaining = peekGameInfo.phaseEndTime - Math.floor(Date.now() / 1000);
          if (remaining > 0 && remaining % 30 === 0) {
            log(`${remaining} seconds remaining in peek phase`);
          }
        }
        log("Peek phase ended");
      } else {
        // On local network, we can advance time
        await ethers.provider.send("evm_increaseTime", [peekPhaseWaitTime + 5]);
        await ethers.provider.send("evm_mine");
        log("Time advanced past peek phase");
      }
    }
    
    // End peek phase and start betting phase
    log("\n----- ENDING PEEK PHASE -----");
    try {
      const endPeekTx = await pokerContract.connect(keeper).endPeekPhase(gameId, veryHighGasTxOptions);
      log("endPeekPhase transaction submitted, waiting for confirmation...");
      const endPeekReceipt = await endPeekTx.wait();
      log("endPeekPhase transaction confirmed!");
      
      // Look for the buffer period event
      const bufferEvent = endPeekReceipt.events.find(e => e.event === "BufferPeriodStarted");
      if (bufferEvent) {
        log(`Buffer period started before betting phase. Current state: ${GameState[bufferEvent.args.currentState]}, Next state: ${GameState[bufferEvent.args.nextState]}`);
      }
      
      const bettingPhaseEvent = endPeekReceipt.events.find(e => e.event === "BettingPhaseStarted");
      if (bettingPhaseEvent) {
        log(`Betting phase started for game ${gameId}`);
      } else {
        log("WARNING: BettingPhaseStarted event not found in logs");
      }
      
      // Get the state update event to check state version
      const stateUpdateEvent = endPeekReceipt.events.find(e => e.event === "GameStateUpdated");
      if (stateUpdateEvent) {
        log(`Game state updated: State=${GameState[stateUpdateEvent.args.state]}, Pot=${stateUpdateEvent.args.potAmount}, CurrentBet=${stateUpdateEvent.args.currentBet}, StateVersion=${stateUpdateEvent.args.stateVersion}`);
      }
      
      // Get updated game info with phase end time
      const updatedGameInfo = await pokerContract.getGameInfo(gameId);
      log(`Phase end time: ${new Date(updatedGameInfo.phaseEndTime * 1000).toISOString()}`);
      log(`Buffer end time: ${new Date(updatedGameInfo.bufferEndTime * 1000).toISOString()}`);
      
// Check if we need to wait for buffer period
const currentTime = Math.floor(Date.now() / 1000);
const bufferWaitTime = updatedGameInfo.bufferEndTime - currentTime;

if (bufferWaitTime > 0) {
  log(`Waiting ${bufferWaitTime} seconds for buffer period to end...`);
  
  // On TEN network, we must wait
  if (network.name === "ten") {
    log("Waiting for buffer period to end on TEN network...");
    
    // Wait until buffer period ends
    while (Math.floor(Date.now() / 1000) < updatedGameInfo.bufferEndTime) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const remaining = updatedGameInfo.bufferEndTime - Math.floor(Date.now() / 1000);
      if (remaining > 0 && remaining % 10 === 0) {
        log(`${remaining} seconds remaining in buffer period`);
      }
    }
    log("Buffer period ended");
  } else {
    // On local network, we can advance time
    await ethers.provider.send("evm_increaseTime", [bufferWaitTime + 5]);
    await ethers.provider.send("evm_mine");
    log("Time advanced past buffer period");
  }
}

// Players place bets
log("\n----- PLAYERS PLACING BETS -----");

// First player places a bet
const bet1Amount = 5;
try {
  const bet1Tx = await pokerContract.connect(players[0]).placeBet(gameId, bet1Amount, highGasTxOptions);
  const bet1Receipt = await bet1Tx.wait();
  log(`Player 1 (${players[0].address}) bet ${bet1Amount} chips`);
  
  // Look for PlayerAction event with nonce
  const playerActionEvent = bet1Receipt.events.find(e => e.event === "PlayerAction");
  if (playerActionEvent) {
    log(`Player action: ${playerActionEvent.args.action}, Amount: ${playerActionEvent.args.amount}, Nonce: ${playerActionEvent.args.nonce}`);
  }
  
  // Check pot amount and current bet
  const gameStateAfterBet1 = await pokerContract.getGameInfo(gameId);
  log(`Pot after bet 1: ${gameStateAfterBet1.potAmount.toString()}, Current bet: ${gameStateAfterBet1.currentBet.toString()}`);
} catch (error) {
  log(`Error when Player 1 tried to bet: ${error.message}`);
}

// Second player calls
const bet2Amount = 5;
try {
  const bet2Tx = await pokerContract.connect(players[1]).placeBet(gameId, bet2Amount, highGasTxOptions);
  const bet2Receipt = await bet2Tx.wait();
  log(`Player 2 (${players[1].address}) bet ${bet2Amount} chips`);
  
  // Look for PlayerAction event with nonce
  const playerActionEvent = bet2Receipt.events.find(e => e.event === "PlayerAction");
  if (playerActionEvent) {
    log(`Player action: ${playerActionEvent.args.action}, Amount: ${playerActionEvent.args.amount}, Nonce: ${playerActionEvent.args.nonce}`);
  }
  
  // Check pot amount and current bet
  const gameStateAfterBet2 = await pokerContract.getGameInfo(gameId);
  log(`Pot after bet 2: ${gameStateAfterBet2.potAmount.toString()}, Current bet: ${gameStateAfterBet2.currentBet.toString()}`);
} catch (error) {
  log(`Error when Player 2 tried to bet: ${error.message}`);
}

// Third player raises
const bet3Amount = 10;
try {
  const bet3Tx = await pokerContract.connect(players[2]).placeBet(gameId, bet3Amount, highGasTxOptions);
  const bet3Receipt = await bet3Tx.wait();
  log(`Player 3 (${players[2].address}) bet ${bet3Amount} chips (raising to 10)`);
  
  // Look for PlayerAction event with nonce
  const playerActionEvent = bet3Receipt.events.find(e => e.event === "PlayerAction");
  if (playerActionEvent) {
    log(`Player action: ${playerActionEvent.args.action}, Amount: ${playerActionEvent.args.amount}, Nonce: ${playerActionEvent.args.nonce}`);
  }
  
  // Check pot amount and current bet
  const gameStateAfterBet3 = await pokerContract.getGameInfo(gameId);
  log(`Pot after bet 3: ${gameStateAfterBet3.potAmount.toString()}, Current bet: ${gameStateAfterBet3.currentBet.toString()}`);
} catch (error) {
  log(`Error when Player 3 tried to bet: ${error.message}`);
}

// First player calls the raise
const bet4Amount = 5; // Additional 5 to match the 10 total
try {
  const bet4Tx = await pokerContract.connect(players[0]).placeBet(gameId, bet4Amount, highGasTxOptions);
  const bet4Receipt = await bet4Tx.wait();
  log(`Player 1 (${players[0].address}) bet additional ${bet4Amount} chips (calling the raise)`);
  
  // Look for PlayerAction event with nonce
  const playerActionEvent = bet4Receipt.events.find(e => e.event === "PlayerAction");
  if (playerActionEvent) {
    log(`Player action: ${playerActionEvent.args.action}, Amount: ${playerActionEvent.args.amount}, Nonce: ${playerActionEvent.args.nonce}`);
  }
  
  // Check pot amount and current bet
  const gameStateAfterBet4 = await pokerContract.getGameInfo(gameId);
  log(`Pot after bet 4: ${gameStateAfterBet4.potAmount.toString()}, Current bet: ${gameStateAfterBet4.currentBet.toString()}`);
} catch (error) {
  log(`Error when Player 1 tried to call the raise: ${error.message}`);
}

// Second player calls the raise
const bet5Amount = 5; // Additional 5 to match the 10 total
try {
  const bet5Tx = await pokerContract.connect(players[1]).placeBet(gameId, bet5Amount, highGasTxOptions);
  const bet5Receipt = await bet5Tx.wait();
  log(`Player 2 (${players[1].address}) bet additional ${bet5Amount} chips (calling the raise)`);
  
  // Look for PlayerAction event with nonce
  const playerActionEvent = bet5Receipt.events.find(e => e.event === "PlayerAction");
  if (playerActionEvent) {
    log(`Player action: ${playerActionEvent.args.action}, Amount: ${playerActionEvent.args.amount}, Nonce: ${playerActionEvent.args.nonce}`);
  }
  
  // Check pot amount and current bet
  const gameStateAfterBet5 = await pokerContract.getGameInfo(gameId);
  log(`Pot after bet 5: ${gameStateAfterBet5.potAmount.toString()}, Current bet: ${gameStateAfterBet5.currentBet.toString()}`);
} catch (error) {
  log(`Error when Player 2 tried to call the raise: ${error.message}`);
}

// Fourth player folds
try {
  const foldTx = await pokerContract.connect(players[3]).fold(gameId, highGasTxOptions);
  const foldReceipt = await foldTx.wait();
  log(`Player 4 (${players[3].address}) folded`);
  
  // Look for PlayerAction event with nonce
  const playerActionEvent = foldReceipt.events.find(e => e.event === "PlayerAction");
  if (playerActionEvent) {
    log(`Player action: ${playerActionEvent.args.action}, Amount: ${playerActionEvent.args.amount}, Nonce: ${playerActionEvent.args.nonce}`);
  }
  
  // Check active player count
  const gameStateAfterFold = await pokerContract.getGameInfo(gameId);
  log(`Active players after fold: ${gameStateAfterFold.activeCount.toString()}`);
} catch (error) {
  log(`Error when Player 4 tried to fold: ${error.message}`);
}

// Log player status after betting
log("\n----- PLAYER STATUS AFTER BETTING -----");
for (let i = 0; i < players.length; i++) {
  try {
    const playerInfo = await pokerContract.getPlayerInfo(gameId, players[i].address);
    log(`Player ${i+1} (${players[i].address}):`);
    log(`  Chip balance: ${playerInfo.chipBalance}`);
    log(`  Current bet: ${playerInfo.currentBet}`);
    log(`  Has folded: ${playerInfo.hasFolded}`);
    log(`  Action nonce: ${playerInfo.actionNonce.toString()}`);
  } catch (error) {
    log(`Error getting info for Player ${i+1}: ${error.message}`);
  }
}

// Check if all players have matched bets
const allMatched = await pokerContract.checkAllPlayersMatched(gameId);
log(`Have all active players matched the current bet? ${allMatched}`);

// Set up listener for GameEnded event
let gameEndedPromise = new Promise((resolve) => {
  const gameEndedListener = pokerContract.once("GameEnded", async (gameIdEvent, winner, potAmount) => {
    if (gameIdEvent.toString() === gameId.toString()) {
      log(`\n===== GAME ENDED EVENT CAPTURED =====`);
      log(`Winner: ${winner}`);
      log(`Pot Amount: ${potAmount.toString()} chips`);
      
      // Find which player number won
      const winnerIndex = players.findIndex(p => p.address.toLowerCase() === winner.toLowerCase());
      if (winnerIndex !== -1) {
        log(`Player ${winnerIndex + 1} (${players[winnerIndex].address}) won the game!`);
      }
      
      resolve({ winner, potAmount });
    }
  });
  
  // Ensure we clean up the listener after a timeout
  setTimeout(() => {
    pokerContract.removeListener("GameEnded", gameEndedListener);
    resolve({ winner: null, potAmount: 0 });
  }, 300000); // 5 minute timeout
});

// Wait for betting phase to end if not manually ending it
log("\n----- WAITING FOR BETTING PHASE TO END -----");
const bettingGameInfo = await pokerContract.getGameInfo(gameId);
const bettingCurrentTime = Math.floor(Date.now() / 1000);
const bettingPhaseWaitTime = bettingGameInfo.phaseEndTime - bettingCurrentTime;

if (bettingPhaseWaitTime > 0) {
  log(`Betting phase ends in ${bettingPhaseWaitTime} seconds at ${new Date(bettingGameInfo.phaseEndTime * 1000).toISOString()}`);
  
  // Since all players have matched, we can end the betting phase manually
  log("All players have matched bets, manually ending betting phase...");
} else {
  log("Betting phase has already ended");
}

//debugging
log("\n----- CHECKING GAME STATE BEFORE ENDING BETTING PHASE -----");
try {
  const gameInfo = await pokerContract.getGameInfo(gameId);
  log(`Current game state: ${GameState[gameInfo.state]}`);
  log(`Phase end time: ${new Date(gameInfo.phaseEndTime * 1000).toISOString()}`);
  log(`Current time: ${new Date().toISOString()}`);
  log(`Buffer end time: ${new Date(gameInfo.bufferEndTime * 1000).toISOString()}`);
  log(`Is in buffer period: ${gameInfo.bufferEndTime > Math.floor(Date.now() / 1000)}`);
  log(`Is phase ended: ${gameInfo.phaseEndTime < Math.floor(Date.now() / 1000)}`);
  
  // Check if the caller is the keeper
  const isKeeper = await pokerContract.isKeeper(keeper.address);
  log(`Is caller (${keeper.address}) a keeper: ${isKeeper}`);
  
  // If the phase hasn't ended yet, wait for it
  const currentTime = Math.floor(Date.now() / 1000);
  if (gameInfo.phaseEndTime > currentTime) {
    const waitTimeSeconds = gameInfo.phaseEndTime - currentTime;
    log(`Betting phase hasn't ended yet. Waiting ${waitTimeSeconds} seconds...`);
    
    if (network.name === "ten") {
      log("Waiting for phase to end on TEN network...");
      while (Math.floor(Date.now() / 1000) < gameInfo.phaseEndTime) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const remaining = gameInfo.phaseEndTime - Math.floor(Date.now() / 1000);
        if (remaining > 0 && remaining % 10 === 0) {
          log(`${remaining} seconds remaining until phase ends`);
        }
      }
      log("Betting phase has now ended");
    } else {
      // On local network, advance time
      await ethers.provider.send("evm_increaseTime", [waitTimeSeconds + 5]);
      await ethers.provider.send("evm_mine");
      log("Time advanced past betting phase end");
    }
    
    // Check game state again after waiting
    const updatedGameInfo = await pokerContract.getGameInfo(gameId);
    log(`Game state after waiting: ${GameState[updatedGameInfo.state]}`);
    log(`Updated phase end time: ${new Date(updatedGameInfo.phaseEndTime * 1000).toISOString()}`);
    log(`Updated buffer end time: ${new Date(updatedGameInfo.bufferEndTime * 1000).toISOString()}`);
  }
} catch (error) {
  log(`Error checking game state: ${error.message}`);
}

// End betting phase and start showdown
log("\n----- ENDING BETTING PHASE -----");
try {
  const endBettingTx = await pokerContract.connect(keeper).endBettingPhase(gameId, veryHighGasTxOptions);
  log("endBettingPhase transaction submitted, waiting for confirmation...");
  const endBettingReceipt = await endBettingTx.wait();
  log("endBettingPhase transaction confirmed!");
  
  // Look for showdown event
  const showdownEvent = endBettingReceipt.events.find(e => e.event === "ShowdownStarted");
  if (showdownEvent) {
    log("Showdown phase started");
  } else {
    log("WARNING: ShowdownStarted event not found in logs");
  }
  
  // Look for game ended event
  const gameEndedEvent = endBettingReceipt.events.find(e => e.event === "GameEnded");
  if (gameEndedEvent) {
    const winner = gameEndedEvent.args.winner;
    const potAmount = gameEndedEvent.args.potAmount.toString();
    
    log(`\n===== GAME RESULTS =====`);
    log(`Winner: ${winner}`);
    log(`Pot Amount: ${potAmount} chips`);
    
    // Find which player number won
    const winnerIndex = players.findIndex(p => p.address.toLowerCase() === winner.toLowerCase());
    if (winnerIndex !== -1) {
      log(`Player ${winnerIndex + 1} (${players[winnerIndex].address}) won the game!`);
    }
  } else {
    log("Game ended event not found in transaction logs - waiting for async event");
    // Wait for the event promise to resolve
    const gameEndResult = await gameEndedPromise;
    if (gameEndResult.winner) {
      log(`Async winner detection: ${gameEndResult.winner}`);
    } else {
      log("Failed to detect winner asynchronously");
    }
  }
  
  // Get the state update event to check final state version
  const stateUpdateEvent = endBettingReceipt.events.find(e => e.event === "GameStateUpdated");
  if (stateUpdateEvent) {
    log(`Final game state: State=${GameState[stateUpdateEvent.args.state]}, Pot=${stateUpdateEvent.args.potAmount}, CurrentBet=${stateUpdateEvent.args.currentBet}, StateVersion=${stateUpdateEvent.args.stateVersion}`);
  }
  
  // Get revealed cards for all players during showdown
  log("\n----- REVEALED CARDS DURING SHOWDOWN -----");
  try {
    const revealedCards = await spectatorContract.getSpectatorCardData(gameId);
    const playerAddresses = revealedCards[0];
    const cardValues = revealedCards[1];
    const cardSuits = revealedCards[2];
    
    for (let i = 0; i < playerAddresses.length; i++) {
      const playerAddr = playerAddresses[i];
      // Check if card value is 0 (indicates folded)
      if (cardValues[i].toNumber() === 0) {
        log(`Player ${playerAddr} folded`);
      } else {
        const cardString = formatCard(cardValues[i].toNumber(), cardSuits[i].toNumber());
        log(`Player ${playerAddr}: ${cardString}`);
      }
    }
  } catch (error) {
    log(`Error getting revealed cards: ${error.message}`);
  }
  
  // Get final game state
  log("\n----- FINAL GAME STATE -----");
  try {
    const finalGameState = await pokerContract.getGameInfo(gameId);
    log(`Game state: ${GameState[finalGameState.state]}`);
    log(`Pot amount: ${finalGameState.potAmount.toString()}`);
    log(`State version: ${finalGameState.stateVersion.toString()}`);
    log(`Is cleaned up: ${finalGameState.isCleanedUp}`);
    
    // Get final player balances
    log("\n----- FINAL PLAYER BALANCES -----");
    for (let i = 0; i < players.length; i++) {
      try {
        const playerInfo = await pokerContract.getPlayerInfo(gameId, players[i].address);
        log(`Player ${i+1} (${players[i].address}):`);
        log(`  Initial balance: ${initialChipBalances[players[i].address].toString()}`);
        log(`  Final balance: ${playerInfo.chipBalance.toString()}`);
        log(`  Difference: ${playerInfo.chipBalance.sub(initialChipBalances[players[i].address]).toString()}`);
        
        // Check if this player gained chips (potential winner)
        if (playerInfo.chipBalance.gt(initialChipBalances[players[i].address])) {
          log(`*** Player ${i+1} gained ${playerInfo.chipBalance.sub(initialChipBalances[players[i].address]).toString()} chips - WINNER! ***`);
        }
      } catch (error) {
        log(`Error getting info for Player ${i+1}: ${error.message}`);
      }
    }
  } catch (error) {
    log(`Error getting final game info: ${error.message}`);
  }
  
  // Check spectator betting results
  log("\n----- SPECTATOR BETTING RESULTS -----");
  try {
    // Get the game info to confirm winner
    const bettingInfo = await spectatorBettingContract.getGameInfo(gameId);
    log(`Betting results processed: ${bettingInfo.resultsProcessed}`);
    log(`Game winner: ${bettingInfo.winner}`);
    log(`Total betting pool: ${formatEth(bettingInfo.totalBetAmount)} ETH`);
    
    // Check winnings for each spectator
    log("\n----- SPECTATOR WINNINGS CHECK -----");
    for (let i = 0; i < spectators.length; i++) {
      const spectator = spectators[i];
      const winningsInfo = await spectatorBettingContract.checkWinnings(gameId, spectator.address);
      const betInfo = await spectatorBettingContract.getBetInfo(gameId, spectator.address);
      log(`Spectator ${i+1} (${spectator.address}):`);
      log(`  Bet on: ${betInfo.playerBetOn}`);
      log(`  Bet amount: ${formatEth(betInfo.amount)} ETH`);
      log(`  Has winnings: ${winningsInfo.hasWinnings}`);
      if (winningsInfo.hasWinnings) {
        log(`  Winnings amount: ${formatEth(winningsInfo.amount)} ETH`);
      }
    }
    
    // Spectators claim winnings
    log("\n----- SPECTATORS CLAIMING WINNINGS -----");
    for (let i = 0; i < spectators.length; i++) {
      const spectator = spectators[i];
      const winningsInfo = await spectatorBettingContract.checkWinnings(gameId, spectator.address);
      
      if (winningsInfo.hasWinnings) {
        // Claim winnings for spectators who bet on the winner
        const beforeBalance = await spectator.getBalance();
        const claimTx = await spectatorBettingContract.connect(spectator).claimWinnings(gameId, txOptions);
        const receipt = await claimTx.wait();
        const afterBalance = await spectator.getBalance();
        const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);
        
        // Calculate actual ETH received (accounting for gas cost)
        const ethReceived = afterBalance.add(gasUsed).sub(beforeBalance);
        
        log(`Spectator ${i+1} (${spectator.address}) successfully claimed ${formatEth(ethReceived)} ETH`);
      } else {
        // Mark as claimed for spectators who didn't bet on the winner
        try {
          const claimTx = await spectatorBettingContract.connect(spectator).claimWinnings(gameId, txOptions);
          await claimTx.wait();
          log(`Spectator ${i+1} (${spectator.address}) marked bet as claimed (no winnings)`);
        } catch (error) {
          log(`Error when Spectator ${i+1} tried to claim: ${error.message}`);
        }
      }
      
      // Verify claim status
      const betInfo = await spectatorBettingContract.getBetInfo(gameId, spectator.address);
      log(`  Bet now marked as claimed: ${betInfo.claimed}`);
    }
  } catch (error) {
    log(`Error processing spectator betting results: ${error.message}`);
  }
  
  // Cleanup the game
  log("\n----- CLEANING UP THE GAME -----");
  try {
    const cleanupTx = await pokerContract.connect(keeper).cleanup(gameId, highGasTxOptions);
    const cleanupReceipt = await cleanupTx.wait();
    log("Game cleaned up successfully");
    
    // Check if game is now marked as cleaned up
    const finalGameInfo = await pokerContract.getGameInfo(gameId);
    log(`Game is cleaned up: ${finalGameInfo.isCleanedUp}`);
    
    // Look for GameNoLongerSpectatable event
    const gameNoLongerSpectatableEvent = cleanupReceipt.events.find(e => e.event === "GameNoLongerSpectatable");
    if (gameNoLongerSpectatableEvent) {
      log("Game is no longer spectatable");
    }
    
    // Look for final state update event
    const finalStateUpdateEvent = cleanupReceipt.events.find(e => e.event === "GameStateUpdated");
    if (finalStateUpdateEvent) {
      log(`Final state update: State=${GameState[finalStateUpdateEvent.args.state]}, StateVersion=${finalStateUpdateEvent.args.stateVersion}`);
    }
  } catch (error) {
    log(`Error cleaning up game: ${error.message}`);
  }
} catch (error) {
  log(`Error ending betting phase: ${error.message}`);
  throw error;
}
} catch (error) {
log(`Error during game flow: ${error.message}`);
throw error;
}

log("\n===== ONE CARD POKER WITH MONTY HALL AND SPECTATOR BETTING TEST COMPLETED =====");

// Close the log file
logStream.end();
});
});