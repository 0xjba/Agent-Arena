import { ethers } from 'ethers';

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;

if (!CONTRACT_ADDRESS) {
  throw new Error('Contract address not found in environment variables');
}

const CONTRACT_ABI = [
  {
    "inputs": [],
    "name": "createGame",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "gameId", "type": "uint256" }],
    "name": "joinGame",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "gameId", "type": "uint256" }],
    "name": "startGame",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "gameId", "type": "uint256" }],
    "name": "peekAtCard",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "gameId", "type": "uint256" }],
    "name": "swapCard",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "gameId", "type": "uint256" },
      { "internalType": "uint256", "name": "betAmount", "type": "uint256" }
    ],
    "name": "placeBet",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "gameId", "type": "uint256" }],
    "name": "fold",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "gameId", "type": "uint256" }],
    "name": "leaveGame",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "gameId", "type": "uint256" }],
    "name": "getGameInfo",
    "outputs": [
      { "internalType": "enum GameLibrary.GameState", "name": "state", "type": "uint8" },
      { "internalType": "uint256", "name": "potAmount", "type": "uint256" },
      { "internalType": "uint256", "name": "currentBet", "type": "uint256" },
      { "internalType": "uint256", "name": "phaseEndTime", "type": "uint256" },
      { "internalType": "uint256", "name": "remainingTime", "type": "uint256" },
      { "internalType": "uint256", "name": "playerCount", "type": "uint256" },
      { "internalType": "uint256", "name": "activeCount", "type": "uint256" },
      { "internalType": "address", "name": "creator", "type": "address" },
      { "internalType": "bool", "name": "isCleanedUp", "type": "bool" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "gameId", "type": "uint256" }],
    "name": "getPlayers",
    "outputs": [{ "internalType": "address[]", "name": "players", "type": "address[]" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "gameId", "type": "uint256" },
      { "internalType": "address", "name": "player", "type": "address" }
    ],
    "name": "getPlayerInfo",
    "outputs": [
      { "internalType": "bool", "name": "isActive", "type": "bool" },
      { "internalType": "bool", "name": "hasPeeked", "type": "bool" },
      { "internalType": "bool", "name": "hasSwappedCard", "type": "bool" },
      { "internalType": "bool", "name": "hasFolded", "type": "bool" },
      { "internalType": "uint256", "name": "chipBalance", "type": "uint256" },
      { "internalType": "uint256", "name": "currentBet", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "currentGameId",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "gameId", "type": "uint256" }],
    "name": "getRevealedCards",
    "outputs": [
      { "internalType": "address[]", "name": "players", "type": "address[]" },
      { "internalType": "uint8[]", "name": "values", "type": "uint8[]" },
      { "internalType": "uint8[]", "name": "suits", "type": "uint8[]" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "gameId", "type": "uint256" },
      { "indexed": false, "internalType": "address", "name": "keeper", "type": "address" },
      { "indexed": false, "internalType": "address", "name": "creator", "type": "address" }
    ],
    "name": "GameCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "gameId", "type": "uint256" },
      { "indexed": true, "internalType": "address", "name": "player", "type": "address" }
    ],
    "name": "PlayerJoined",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "gameId", "type": "uint256" },
      { "indexed": true, "internalType": "address", "name": "player", "type": "address" }
    ],
    "name": "CardDealt",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "player", "type": "address" },
      { "indexed": false, "internalType": "uint8", "name": "value", "type": "uint8" },
      { "indexed": false, "internalType": "uint8", "name": "suit", "type": "uint8" }
    ],
    "name": "CardPeeked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "gameId", "type": "uint256" },
      { "indexed": false, "internalType": "address", "name": "player", "type": "address" }
    ],
    "name": "PlayerPeeked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "gameId", "type": "uint256" },
      { "indexed": false, "internalType": "address", "name": "player", "type": "address" }
    ],
    "name": "CardSwapped",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "gameId", "type": "uint256" },
      { "indexed": false, "internalType": "address", "name": "player", "type": "address" },
      { "indexed": false, "internalType": "uint8", "name": "value", "type": "uint8" },
      { "indexed": false, "internalType": "uint8", "name": "suit", "type": "uint8" }
    ],
    "name": "CardRevealed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "internalType": "uint256", "name": "gameId", "type": "uint256" }],
    "name": "PeekPhaseStarted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "internalType": "uint256", "name": "gameId", "type": "uint256" }],
    "name": "BettingPhaseStarted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "internalType": "uint256", "name": "gameId", "type": "uint256" }],
    "name": "ShowdownStarted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "gameId", "type": "uint256" },
      { "indexed": false, "internalType": "address", "name": "winner", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "potAmount", "type": "uint256" }
    ],
    "name": "GameEnded",
    "type": "event"
  }
];

export enum GameState {
  PRE_GAME,
  PEEK_PHASE,
  BETTING_PHASE,
  SHOWDOWN,
  ENDED
}

export interface GameInfo {
  state: GameState;
  potAmount: number;
  currentBet: number;
  phaseEndTime: number;
  remainingTime: number;
  playerCount: number;
  activeCount: number;
  creator: string;
  isCleanedUp: boolean;
}

export interface PlayerInfo {
  isActive: boolean;
  hasPeeked: boolean;
  hasSwappedCard: boolean;
  hasFolded: boolean;
  chipBalance: number;
  currentBet: number;
}

export interface RevealedCards {
  players: string[];
  values: number[];
  suits: number[];
}

let provider: ethers.providers.Web3Provider;
let contract: ethers.Contract;
let isInitialized = false;

export async function connectWallet() {
  if (!window.ethereum) {
    throw new Error("Metamask not detected");
  }

  provider = new ethers.providers.Web3Provider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const signer = provider.getSigner();
  contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
  isInitialized = true;
  
  return {
    address: await signer.getAddress(),
    contract
  };
}

export function isContractInitialized() {
  return isInitialized;
}

export async function ensureContractInitialized() {
  if (!isInitialized) {
    await connectWallet();
  }
}

export async function createGame() {
  await ensureContractInitialized();
  const tx = await contract.createGame();
  const receipt = await tx.wait();
  const event = receipt.events?.find(e => e.event === "GameCreated");
  return event?.args?.gameId.toNumber();
}

export async function joinGame(gameId: number) {
  await ensureContractInitialized();
  const tx = await contract.joinGame(gameId);
  await tx.wait();
}

export async function startGame(gameId: number) {
  await ensureContractInitialized();
  const tx = await contract.startGame(gameId);
  await tx.wait();
}

export async function getGameInfo(gameId: number): Promise<GameInfo> {
  await ensureContractInitialized();
  const info = await contract.getGameInfo(gameId);
  return {
    state: info.state,
    potAmount: info.potAmount.toNumber(),
    currentBet: info.currentBet.toNumber(),
    phaseEndTime: info.phaseEndTime.toNumber(),
    remainingTime: info.remainingTime.toNumber(),
    playerCount: info.playerCount.toNumber(),
    activeCount: info.activeCount.toNumber(),
    creator: info.creator,
    isCleanedUp: info.isCleanedUp
  };
}

export async function getPlayers(gameId: number): Promise<string[]> {
  await ensureContractInitialized();
  return await contract.getPlayers(gameId);
}

export async function getPlayerInfo(gameId: number, player: string): Promise<PlayerInfo> {
  await ensureContractInitialized();
  const info = await contract.getPlayerInfo(gameId, player);
  return {
    isActive: info.isActive,
    hasPeeked: info.hasPeeked,
    hasSwappedCard: info.hasSwappedCard,
    hasFolded: info.hasFolded,
    chipBalance: info.chipBalance.toNumber(),
    currentBet: info.currentBet.toNumber()
  };
}

export async function getCurrentGameId(): Promise<number> {
  await ensureContractInitialized();
  return (await contract.currentGameId()).toNumber();
}

export async function peekAtCard(gameId: number) {
  await ensureContractInitialized();
  const tx = await contract.peekAtCard(gameId);
  await tx.wait();
}

export async function swapCard(gameId: number) {
  await ensureContractInitialized();
  const tx = await contract.swapCard(gameId);
  await tx.wait();
}

export async function placeBet(gameId: number, betAmount: number) {
  await ensureContractInitialized();
  const tx = await contract.placeBet(gameId, betAmount);
  await tx.wait();
}

export async function fold(gameId: number) {
  await ensureContractInitialized();
  const tx = await contract.fold(gameId);
  await tx.wait();
}

export async function leaveGame(gameId: number) {
  await ensureContractInitialized();
  const tx = await contract.leaveGame(gameId);
  await tx.wait();
}

export async function getRevealedCards(gameId: number): Promise<RevealedCards> {
  await ensureContractInitialized();
  const { players, values, suits } = await contract.getRevealedCards(gameId);
  return {
    players,
    values: values.map((v: ethers.BigNumber) => v.toNumber()),
    suits: suits.map((s: ethers.BigNumber) => s.toNumber())
  };
}

export function setupEventListeners(
  gameId: number,
  callbacks: {
    onGameCreated?: (gameId: number, keeper: string, creator: string) => void;
    onPlayerJoined?: (gameId: number, player: string) => void;
    onCardDealt?: (gameId: number, player: string) => void;
    onCardPeeked?: (player: string, value: number, suit: number) => void;
    onPlayerPeeked?: (gameId: number, player: string) => void;
    onCardSwapped?: (gameId: number, player: string) => void;
    onCardRevealed?: (gameId: number, player: string, value: number, suit: number) => void;
    onPeekPhaseStarted?: (gameId: number) => void;
    onBettingPhaseStarted?: (gameId: number) => void;
    onShowdownStarted?: (gameId: number) => void;
    onGameEnded?: (gameId: number, winner: string, potAmount: number) => void;
  }
) {
  if (!isInitialized) return;

  const filters = {
    gameCreated: contract.filters.GameCreated(gameId),
    playerJoined: contract.filters.PlayerJoined(gameId),
    cardDealt: contract.filters.CardDealt(gameId),
    cardPeeked: contract.filters.CardPeeked(null),
    playerPeeked: contract.filters.PlayerPeeked(gameId),
    cardSwapped: contract.filters.CardSwapped(gameId),
    cardRevealed: contract.filters.CardRevealed(gameId),
    peekPhaseStarted: contract.filters.PeekPhaseStarted(gameId),
    bettingPhaseStarted: contract.filters.BettingPhaseStarted(gameId),
    showdownStarted: contract.filters.ShowdownStarted(gameId),
    gameEnded: contract.filters.GameEnded(gameId)
  };

  if (callbacks.onGameCreated) {
    contract.on(filters.gameCreated, callbacks.onGameCreated);
  }
  if (callbacks.onPlayerJoined) {
    contract.on(filters.playerJoined, callbacks.onPlayerJoined);
  }
  if (callbacks.onCardDealt) {
    contract.on(filters.cardDealt, callbacks.onCardDealt);
  }
  if (callbacks.onCardPeeked) {
    contract.on(filters.cardPeeked, callbacks.onCardPeeked);
  }
  if (callbacks.onPlayerPeeked) {
    contract.on(filters.playerPeeked, callbacks.onPlayerPeeked);
  }
  if (callbacks.onCardSwapped) {
    contract.on(filters.cardSwapped, callbacks.onCardSwapped);
  }
  if (callbacks.onCardRevealed) {
    contract.on(filters.cardRevealed, callbacks.onCardRevealed);
  }
  if (callbacks.onPeekPhaseStarted) {
    contract.on(filters.peekPhaseStarted, callbacks.onPeekPhaseStarted);
  }
  if (callbacks.onBettingPhaseStarted) {
    contract.on(filters.bettingPhaseStarted, callbacks.onBettingPhaseStarted);
  }
  if (callbacks.onShowdownStarted) {
    contract.on(filters.showdownStarted, callbacks.onShowdownStarted);
  }
  if (callbacks.onGameEnded) {
    contract.on(filters.gameEnded, callbacks.onGameEnded);
  }

  return () => {
    Object.values(filters).forEach(filter => {
      contract.off(filter);
    });
  };
}