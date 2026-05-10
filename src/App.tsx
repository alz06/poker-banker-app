import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  DollarSign,
  Download,
  History,
  Mic,
  MicOff,
  Plus,
  RotateCcw,
  Save,
  Settings,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import "./App.css";

type Player = {
  name: string;
  color: string;
  buyIns: number;
  hostFeePaid: boolean;
  cashOut: string;
};

type LogItem = {
  id: string;
  time: string;
  text: string;
  kind: "info" | "success" | "warn" | "undo" | "pending" | "cashout";
};

type PendingBuyIn = {
  id: string;
  playerName: string;
  amount: number; // poker chip buy-in amount, normally $20
  hostFeeAmount: number; // host fee collected with first buy-in, normally $10
  cashDue: number; // amount banker must physically collect now
  includesHostFee: boolean;
  createdAt: string;
};

type CashboxCheck = {
  id: string;
  time: string;
  expected: number;
  actual: number;
  diff: number;
};

type Game = {
  id: string;
  date: string;
  host: string;
  buyInAmount: number;
  hostFeeAmount: number;
  chipUnit: number;
  players: Player[];
  pendingBuyIns: PendingBuyIn[];
  cashboxChecks: CashboxCheck[];
  log: LogItem[];
  finalized: boolean;
  settings: {
    voice: boolean;
    sound: boolean;
    vibration: boolean;
  };
};

type AppState = {
  currentGame: Game;
  history: Game[];
};

const STORAGE_KEY = "poker_banker_local_v1";

const REGULAR_PLAYERS = [
  { name: "Ahmad", color: "p-blue" },
  { name: "Parviz", color: "p-green" },
  { name: "Tom", color: "p-orange" },
  { name: "Sina", color: "p-purple" },
  { name: "Jafar", color: "p-rose" },
  { name: "Cyrus", color: "p-cyan" },
  { name: "Mohsen", color: "p-yellow" },
  { name: "Farhad", color: "p-lime" },
  { name: "Reza", color: "p-sky" },
  { name: "Alireza", color: "p-stone" },
];

function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function todayString() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

function timeString() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function money(value: number | string) {
  const n = Number(value || 0);
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString()}`;
}

function makeEmptyGame(): Game {
  return {
    id: uid(),
    date: todayString(),
    host: "",
    buyInAmount: 20,
    hostFeeAmount: 10,
    chipUnit: 1,
    players: REGULAR_PLAYERS.map((p) => ({
      name: p.name,
      color: p.color,
      buyIns: 0,
      hostFeePaid: false,
      cashOut: "",
    })),
    pendingBuyIns: [],
    cashboxChecks: [],
    log: [],
    finalized: false,
    settings: {
      voice: true,
      sound: true,
      vibration: true,
    },
  };
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { currentGame: makeEmptyGame(), history: [] };
    const parsed = JSON.parse(raw);
    if (!parsed?.currentGame) return { currentGame: makeEmptyGame(), history: [] };
    return parsed;
  } catch {
    return { currentGame: makeEmptyGame(), history: [] };
  }
}

function speak(text: string, enabled: boolean) {
  if (!enabled) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  } catch {
    // silent fallback
  }
}

function vibrate(enabled: boolean) {
  try {
    if (enabled && navigator.vibrate) navigator.vibrate(70);
  } catch {
    // silent fallback
  }
}

function addLog(game: Game, text: string, kind: LogItem["kind"] = "info") {
  game.log.unshift({ id: uid(), time: timeString(), text, kind });
}

function cloneGame(game: Game): Game {
  return JSON.parse(JSON.stringify(game));
}

export default function App() {
  const [state, setState] = useState<AppState>(loadState);
  const [screen, setScreen] = useState<"live" | "setup" | "settings">("setup");
  const [pickerMode, setPickerMode] = useState<null | "buyin" | "cashout" | "hostfee">(null);
  const [cashoutPlayer, setCashoutPlayer] = useState<string | null>(null);
  const [cashoutDraft, setCashoutDraft] = useState("");
  const [cashboxOpen, setCashboxOpen] = useState(false);
  const [actualCashbox, setActualCashbox] = useState("");
  const [showUndo, setShowUndo] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showNewConfirm, setShowNewConfirm] = useState(false);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [setupError, setSetupError] = useState("");

  const game = state.currentGame;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const totals = useMemo(() => {
    const totalBuyIns = game.players.reduce((sum, p) => sum + p.buyIns, 0);
    const bank = totalBuyIns * game.buyInAmount;
    const cashOut = game.players.reduce((sum, p) => sum + Number(p.cashOut || 0), 0);
    const hostFeePlayers = game.players.filter((p) => p.name !== game.host);
    const hostPaidCount = hostFeePlayers.filter((p) => p.hostFeePaid).length;
    const hostOwedCount = hostFeePlayers.length;
    return {
      totalBuyIns,
      bank,
      cashOut,
      difference: cashOut - bank,
      hostPaidCount,
      hostOwedCount,
      hostFees: hostPaidCount * game.hostFeeAmount,
      pendingTotal: game.pendingBuyIns.reduce((sum, p) => sum + p.cashDue, 0),
    };
  }, [game]);

  const warnings = useMemo(() => {
    const result: string[] = [];
    const unpaid = game.players.filter((p) => p.name !== game.host && p.buyIns > 0 && !p.hostFeePaid).map((p) => p.name);
    if (unpaid.length) result.push(`Host fee missing: ${unpaid.join(", ")}`);
    if (game.pendingBuyIns.length) result.push(`${game.pendingBuyIns.length} pending buy-in waiting for cash confirmation`);
    if (totals.cashOut > 0 && totals.difference !== 0) {
      result.push(`Game does not balance yet: ${totals.difference > 0 ? "+" : ""}${money(totals.difference)}`);
    }
    return result;
  }, [game, totals]);

  const audit = useMemo(() => {
    return {
      confirmedBuyIns: totals.totalBuyIns,
      pendingCanceled: game.log.filter((l) => l.text.includes("pending buy-in canceled")).length,
      undoActions: game.log.filter((l) => l.kind === "undo" || l.text.startsWith("UNDO:")).length,
      cashboxChecks: game.cashboxChecks.length,
    };
  }, [game, totals]);

  function updateGame(mutator: (g: Game) => void) {
    setState((prev) => {
      const g = cloneGame(prev.currentGame);
      mutator(g);
      return { ...prev, currentGame: g };
    });
  }

  function hasCurrentGameActivity(g: Game) {
    return (
      g.players.some((p) => p.buyIns > 0 || p.hostFeePaid || p.cashOut !== "") ||
      g.pendingBuyIns.length > 0 ||
      g.cashboxChecks.length > 0 ||
      g.log.length > 0
    );
  }

  function requestNewGame() {
    const today = todayString();
    const sameDateExists = game.date === today || state.history.some((h) => h.date === today);
    if (sameDateExists || hasCurrentGameActivity(game)) {
      setShowNewConfirm(true);
      return;
    }
    startNewGame();
  }

  function enterLiveGame() {
    if (!game.host) {
      setSetupError("Host needs to be chosen before the game can start.");
      return;
    }
    setSetupError("");
    setScreen("live");
  }

  function startNewGame() {
    const oldSettings = game.settings;
    const newGame = makeEmptyGame();
    newGame.settings = oldSettings;
    setState((prev) => ({ ...prev, currentGame: newGame }));
    setScreen("setup");
    setShowNewConfirm(false);
  }

  function addGuestPlayer() {
    const name = newPlayerName.trim();
    if (!name) return;
    if (game.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return;
    updateGame((g) => {
      g.players.push({ name, color: "p-guest", buyIns: 0, hostFeePaid: false, cashOut: "" });
      addLog(g, `Guest player added: ${name}.`, "info");
    });
    setNewPlayerName("");
  }

  function createPendingBuyIn(playerName: string) {
    updateGame((g) => {
      const player = g.players.find((p) => p.name === playerName);
      if (!player) return;

      // First buy-in of the night also collects host fee if it was not paid yet.
      // Poker bank still only increases by the chip buy-in amount. Host fee stays separate.
      const isHost = player.name === g.host;
      const includesHostFee = !isHost && !player.hostFeePaid;
      const hostFeeAmount = includesHostFee ? g.hostFeeAmount : 0;
      const cashDue = g.buyInAmount + hostFeeAmount;

      g.pendingBuyIns.push({
        id: uid(),
        playerName,
        amount: g.buyInAmount,
        hostFeeAmount,
        cashDue,
        includesHostFee,
        createdAt: timeString(),
      });

      addLog(
        g,
        `${playerName} pending buy-in created. Collect ${money(cashDue)}${includesHostFee ? ` (${money(g.buyInAmount)} buy-in + ${money(g.hostFeeAmount)} host fee)` : ""}.`,
        "pending"
      );
    });
    setPickerMode(null);
  }

  function confirmPending(id: string) {
    updateGame((g) => {
      const pending = g.pendingBuyIns.find((p) => p.id === id);
      if (!pending) return;
      const player = g.players.find((p) => p.name === pending.playerName);
      if (!player) return;
      player.buyIns += 1;
      if (pending.includesHostFee) player.hostFeePaid = true;
      g.pendingBuyIns = g.pendingBuyIns.filter((p) => p.id !== id);
      addLog(
        g,
        `${player.name} buy-in confirmed for ${money(g.buyInAmount)}${pending.includesHostFee ? ` and host fee collected for ${money(pending.hostFeeAmount)}` : ""}.`,
        "success"
      );
      speak(`${player.name} buy-in confirmed.`, g.settings.voice);
      vibrate(g.settings.vibration);
    });
  }

  function cancelPending(id: string) {
    updateGame((g) => {
      const pending = g.pendingBuyIns.find((p) => p.id === id);
      if (pending) addLog(g, `${pending.playerName} pending buy-in canceled.`, "undo");
      g.pendingBuyIns = g.pendingBuyIns.filter((p) => p.id !== id);
    });
  }

  function toggleHostFee(playerName: string) {
    updateGame((g) => {
      const player = g.players.find((p) => p.name === playerName);
      if (!player) return;
      player.hostFeePaid = !player.hostFeePaid;
      addLog(g, `${player.name} host fee marked ${player.hostFeePaid ? "paid" : "unpaid"}.`, player.hostFeePaid ? "success" : "undo");
    });
    setPickerMode(null);
  }

  function openCashOut(playerName: string) {
    const p = game.players.find((x) => x.name === playerName);
    setCashoutPlayer(playerName);
    setCashoutDraft(p?.cashOut || "");
    setPickerMode(null);
  }

  function confirmCashOut() {
    if (!cashoutPlayer) return;
    const value = Number(cashoutDraft || 0);
    if (Number.isNaN(value) || value < 0) return;
    if (game.chipUnit > 1 && value % game.chipUnit !== 0) return;
    updateGame((g) => {
      const player = g.players.find((p) => p.name === cashoutPlayer);
      if (!player) return;
      player.cashOut = String(value);
      const bought = player.buyIns * g.buyInAmount;
      addLog(g, `${player.name} cash out confirmed: ${money(value)}. Balance ${value - bought >= 0 ? "+" : ""}${money(value - bought)}.`, "cashout");
    });
    setCashoutPlayer(null);
    setCashoutDraft("");
  }

  function saveCashboxCheck() {
    const actual = Number(actualCashbox || 0);
    if (Number.isNaN(actual) || actual < 0) return;
    updateGame((g) => {
      const expected = g.players.reduce((sum, p) => sum + p.buyIns * g.buyInAmount, 0);
      const diff = actual - expected;
      g.cashboxChecks.unshift({ id: uid(), time: timeString(), expected, actual, diff });
      addLog(g, `Cashbox check: expected ${money(expected)}, actual ${money(actual)}, difference ${diff >= 0 ? "+" : ""}${money(diff)}.`, diff === 0 ? "success" : "warn");
    });
    setActualCashbox("");
    setCashboxOpen(false);
  }

  function undoLastMaterialAction() {
    updateGame((g) => {
      const last = g.log.find((l) => l.kind !== "undo" && l.kind !== "info" && l.kind !== "warn");
      if (!last) {
        addLog(g, "UNDO attempted, but there was no undoable action.", "warn");
        return;
      }

      const buyMatch = last.text.match(/^(.+) buy-in confirmed/);
      const cashMatch = last.text.match(/^(.+) cash out confirmed/);
      const hostPaidMatch = last.text.match(/^(.+) host fee marked paid/);
      const pendingMatch = last.text.match(/^(.+) pending buy-in created/);

      if (buyMatch) {
        const player = g.players.find((p) => p.name === buyMatch[1]);
        if (player && player.buyIns > 0) {
          player.buyIns -= 1;
          addLog(g, `UNDO: ${player.name} confirmed buy-in removed.`, "undo");
        }
      } else if (cashMatch) {
        const player = g.players.find((p) => p.name === cashMatch[1]);
        if (player) {
          player.cashOut = "";
          addLog(g, `UNDO: ${player.name} cash out removed.`, "undo");
        }
      } else if (hostPaidMatch) {
        const player = g.players.find((p) => p.name === hostPaidMatch[1]);
        if (player) {
          player.hostFeePaid = false;
          addLog(g, `UNDO: ${player.name} host fee payment removed.`, "undo");
        }
      } else if (pendingMatch) {
        const playerName = pendingMatch[1];
        const pending = g.pendingBuyIns.find((p) => p.playerName === playerName);
        if (pending) {
          g.pendingBuyIns = g.pendingBuyIns.filter((p) => p.id !== pending.id);
          addLog(g, `UNDO: ${playerName} pending buy-in removed.`, "undo");
        }
      } else {
        addLog(g, "UNDO attempted, but last action was not undoable.", "warn");
      }
    });
    setShowUndo(false);
  }

  function saveFinalGame() {
    const finalized = cloneGame(game);
    finalized.finalized = true;
    addLog(finalized, `Game saved. Difference ${totals.difference >= 0 ? "+" : ""}${money(totals.difference)}.`, totals.difference === 0 ? "success" : "warn");
    setState((prev) => ({ currentGame: finalized, history: [finalized, ...(prev.history || [])] }));
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `poker-banker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printFinalTable() {
    window.print();
  }

  function importBackup(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (parsed?.currentGame) setState(parsed);
      } catch {
        alert("Could not import backup file.");
      }
    };
    reader.readAsText(file);
  }

  const selectedCashoutPlayer = game.players.find((p) => p.name === cashoutPlayer);
  const selectedBought = selectedCashoutPlayer ? selectedCashoutPlayer.buyIns * game.buyInAmount : 0;
  const selectedCash = Number(cashoutDraft || 0);

  return (
    <div className="app-shell">
      <div className="top-card sticky">
        <div className="top-row">
          <div>
            <div className="title">Poker Banker</div>
            <div className="subtitle">{game.date} {game.host ? `• Host: ${game.host}` : "• Host not selected"}</div>
          </div>
          <div className="top-buttons">
            <button className="small-btn" onClick={() => setScreen(screen === "settings" ? "live" : "settings")}>{game.settings.voice ? <Mic size={18} /> : <MicOff size={18} />}</button>
            <button className="small-btn" onClick={requestNewGame}>New</button>
          </div>
        </div>
        <div className="stats-grid four">
          <Stat label="Bank" value={money(totals.bank)} />
          <Stat label="Cash Out" value={money(totals.cashOut)} />
          <Stat label="Pending" value={money(totals.pendingTotal)} />
          <Stat label="Host Fees" value={`${totals.hostPaidCount}/${totals.hostOwedCount}`} />
        </div>
        {warnings.length > 0 && <div className="warning-line">SafeGuard: {warnings[0]}</div>}
      </div>

      {screen === "setup" && (
        <div className="card">
          <h2>Game Setup</h2>
          <div className="form-grid">
            <label>Game Date<input value={game.date} onChange={(e) => updateGame((g) => { g.date = e.target.value; })} /></label>
            <label>Host<select value={game.host} onChange={(e) => updateGame((g) => { g.host = e.target.value; })}><option value="">Select host</option>{game.players.map((p) => <option key={p.name}>{p.name}</option>)}</select></label>
            <label>Buy-in Amount<input inputMode="numeric" value={game.buyInAmount} onChange={(e) => updateGame((g) => { g.buyInAmount = Number(e.target.value || 20); })} /></label>
            <label>Host Fee<input inputMode="numeric" value={game.hostFeeAmount} onChange={(e) => updateGame((g) => { g.hostFeeAmount = Number(e.target.value || 10); })} /></label>
            <label>Smallest Chip Unit<input inputMode="numeric" value={game.chipUnit} onChange={(e) => updateGame((g) => { g.chipUnit = Number(e.target.value || 1); })} /></label>
          </div>
          <div className="guest-row">
            <input placeholder="Guest player name" value={newPlayerName} onChange={(e) => setNewPlayerName(e.target.value)} />
            <button onClick={addGuestPlayer}>Add Guest</button>
          </div>
          {setupError && <div className="error-box">{setupError}</div>}
          <button className="primary big" onClick={enterLiveGame}>Start / Return to Game</button>
        </div>
      )}

      {screen === "settings" && (
        <div className="card">
          <h2>Settings</h2>
          <Toggle label="Voice confirmation" value={game.settings.voice} onClick={() => updateGame((g) => { g.settings.voice = !g.settings.voice; })} />
          <Toggle label="Sound alert" value={game.settings.sound} onClick={() => updateGame((g) => { g.settings.sound = !g.settings.sound; })} />
          <Toggle label="Vibration" value={game.settings.vibration} onClick={() => updateGame((g) => { g.settings.vibration = !g.settings.vibration; })} />
          <div className="two-buttons">
            <button className="primary" onClick={exportBackup}><Download size={18} /> Export Backup</button>
            <label className="upload-btn"><Upload size={18} /> Import Backup<input type="file" accept="application/json" onChange={importBackup} /></label>
          </div>
        </div>
      )}

      {screen === "live" && (
        <>
          <div className="action-grid">
            <button className="main-action" onClick={() => setPickerMode("buyin")}><Plus />Buy-In</button>
            <button className="main-action secondary" onClick={() => setPickerMode("cashout")}><DollarSign />Cash Out</button>
            <button className="main-action secondary" onClick={() => setCashboxOpen(true)}><ShieldCheck />Cashbox</button>
            <button className="main-action secondary" onClick={() => setShowUndo(true)}><RotateCcw />Undo</button>
            <button className="main-action secondary" onClick={() => setShowLog(true)}><History />Log</button>
          </div>

          {game.pendingBuyIns.length > 0 && (
            <div className="card amber">
              <h2>Pending Buy-ins</h2>
              {game.pendingBuyIns.map((p) => (
                <div className="pending-row" key={p.id}>
                  <div className="pending-text">
                    <b>{p.playerName}</b>
                    <span className="cash-due">Collect Now: {money(p.cashDue)}</span>
                    <span>{money(p.amount)} buy-in{p.includesHostFee ? ` + ${money(p.hostFeeAmount)} host fee` : ""} • {p.createdAt}</span>
                  </div>
                  <div className="pending-actions">
                    <button className="primary" onClick={() => confirmPending(p.id)}>Cash Received</button>
                    <button onClick={() => cancelPending(p.id)}>Cancel</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className={`card watchdog ${warnings.length ? "amber" : "green"}`}>
            <h2>{warnings.length ? <AlertTriangle /> : <ShieldCheck />} SafeGuard</h2>
            {warnings.length ? warnings.map((w, i) => <div className="watch-line" key={i}>• {w}</div>) : <div className="watch-line">No active warnings. Current bank is {money(totals.bank)}.</div>}
          </div>

          <PokerChart game={game} />

          <div className="card">
            <h2>Final Balance</h2>
            <div className="stats-grid three">
              <Stat label="Total Buy-ins" value={money(totals.bank)} />
              <Stat label="Cash Out" value={money(totals.cashOut)} />
              <Stat label="Difference" value={`${totals.difference >= 0 ? "+" : ""}${money(totals.difference)}`} good={totals.difference === 0} />
            </div>
            <div className="audit-box">
              <b>SafeGuard Audit</b>
              <span>Buy-ins confirmed: {audit.confirmedBuyIns}</span>
              <span>Pending canceled: {audit.pendingCanceled}</span>
              <span>Undo actions: {audit.undoActions}</span>
              <span>Cashbox checks: {audit.cashboxChecks}</span>
            </div>
            <button className="primary big" onClick={() => setShowFinishConfirm(true)}><Save size={18} /> Finish & Save Night</button>
            <button className="neutral big" onClick={printFinalTable}><Download size={18} /> Print / Save Table</button>
          </div>
        </>
      )}

      <AnimatePresence>
        {pickerMode && (
          <PlayerPicker
            mode={pickerMode}
            players={game.players}
            onClose={() => setPickerMode(null)}
            onPick={(name) => {
              if (pickerMode === "buyin") createPendingBuyIn(name);
              if (pickerMode === "cashout") openCashOut(name);
              if (pickerMode === "hostfee") toggleHostFee(name);
            }}
          />
        )}

        {cashoutPlayer && selectedCashoutPlayer && (
          <Modal title={`Cash Out: ${cashoutPlayer}`} onClose={() => setCashoutPlayer(null)}>
            <div className="stats-grid three">
              <Stat label="Buy-ins" value={String(selectedCashoutPlayer.buyIns)} />
              <Stat label="Bought" value={money(selectedBought)} />
              <Stat label="Balance" value={`${selectedCash - selectedBought >= 0 ? "+" : ""}${money(selectedCash - selectedBought)}`} />
            </div>
            <input className="big-input" inputMode="numeric" autoFocus placeholder="Cash out amount" value={cashoutDraft} onChange={(e) => setCashoutDraft(e.target.value.replace(/[^0-9]/g, ""))} />
            {game.chipUnit > 1 && cashoutDraft && Number(cashoutDraft) % game.chipUnit !== 0 && <div className="error-box">Amount must match chip unit: ${game.chipUnit}</div>}
            <button className="primary big" onClick={confirmCashOut}>Confirm Cash Out</button>
          </Modal>
        )}

        {cashboxOpen && (
          <Modal title="Cashbox SafeGuard" onClose={() => setCashboxOpen(false)}>
            <div className="stats-grid two">
              <Stat label="Expected Cashbox" value={money(totals.bank)} />
              <Stat label="Pending Cash Due" value={money(totals.pendingTotal)} />
            </div>
            <input className="big-input" inputMode="numeric" autoFocus placeholder="Actual cash counted" value={actualCashbox} onChange={(e) => setActualCashbox(e.target.value.replace(/[^0-9]/g, ""))} />
            {actualCashbox !== "" && <div className={Number(actualCashbox) - totals.bank === 0 ? "ok-box" : "error-box"}>Difference: {Number(actualCashbox) - totals.bank >= 0 ? "+" : ""}{money(Number(actualCashbox) - totals.bank)}</div>}
            <button className="primary big" onClick={saveCashboxCheck}>Save Cashbox Check</button>
            {game.cashboxChecks.slice(0, 5).map((c) => <div className="log-line" key={c.id}>{c.time}: expected {money(c.expected)} / actual {money(c.actual)} / diff {c.diff >= 0 ? "+" : ""}{money(c.diff)}</div>)}
          </Modal>
        )}

        {showUndo && (
          <Modal title="Undo Last Action" onClose={() => setShowUndo(false)}>
            <div className="warning-box">Undo will be recorded in the night log so the story of the game stays clear.</div>
            <button className="danger big" onClick={undoLastMaterialAction}>Yes, Undo Last Action</button>
            <button className="neutral big" onClick={() => setShowUndo(false)}>Cancel</button>
          </Modal>
        )}

        {showFinishConfirm && (
          <Modal title="Finish & Save Night?" onClose={() => setShowFinishConfirm(false)}>
            <div className={totals.difference === 0 && game.pendingBuyIns.length === 0 ? "ok-box" : "warning-box"}>
              Total Buy-ins: {money(totals.bank)}<br />
              Total Cash Out: {money(totals.cashOut)}<br />
              Final Difference: {totals.difference >= 0 ? "+" : ""}{money(totals.difference)}<br />
              Pending Buy-ins: {game.pendingBuyIns.length}
            </div>
            {(totals.difference !== 0 || game.pendingBuyIns.length > 0) && (
              <div className="error-box">
                SafeGuard warning: this night is not clean yet. Only finish if you intentionally want to save it with this issue.
              </div>
            )}
            <button className="primary big" onClick={() => { saveFinalGame(); setShowFinishConfirm(false); }}>Yes, Finish & Save Night</button>
            <button className="neutral big" onClick={() => setShowFinishConfirm(false)}>Cancel</button>
          </Modal>
        )}

        {showNewConfirm && (
          <Modal title="Start New Game?" onClose={() => setShowNewConfirm(false)}>
            <div className="warning-box">
              There is already a session for this date, or the current session has activity. Are you sure you want to proceed?
            </div>
            <div className="warning-box">
              Starting a new game will clear the current live screen. Export a backup first if you want to preserve it.
            </div>
            <button className="danger big" onClick={startNewGame}>Yes, Start New Game</button>
            <button className="neutral big" onClick={() => setShowNewConfirm(false)}>Cancel</button>
          </Modal>
        )}

        {showLog && (
          <Modal title="Night Log" onClose={() => setShowLog(false)} wide>
            {game.log.length === 0 ? <div className="muted">No log yet.</div> : game.log.map((l) => <div key={l.id} className={`log-line ${l.kind}`}><b>{l.time}</b> — {l.text}</div>)}
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

function Toggle({ label, value, onClick }: { label: string; value: boolean; onClick: () => void }) {
  return <button className="toggle-row" onClick={onClick}><span><Settings size={18} /> {label}</span><b className={value ? "on" : "off"}>{value ? "On" : "Off"}</b></button>;
}

function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return <div className={good ? "stat good" : "stat"}><span>{label}</span><b>{value}</b></div>;
}

function PokerChart({ game }: { game: Game }) {
  return (
    <div className="card chart-card compact-chart-card">
      <div className="compact-table-title">Live Game Table</div>
      <table className="compact-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Buys</th>
            <th>Bought</th>
            <th>H</th>
            <th>Cash</th>
            <th>Bal</th>
          </tr>
        </thead>
        <tbody>
          {game.players.map((p) => {
            const bought = p.buyIns * game.buyInAmount;
            const cash = Number(p.cashOut || 0);
            const balance = p.cashOut === "" ? null : cash - bought;
            return (
              <tr key={p.name}>
                <td className="compact-name"><b>{p.name}</b></td>
                <td className="compact-buys"><b>{p.buyIns || ""}</b></td>
                <td><b>{bought ? money(bought) : ""}</b></td>
                <td className={p.name === game.host ? "host-empty" : p.hostFeePaid ? "host-paid" : "host-empty"}>{p.name === game.host ? "-" : p.hostFeePaid ? "✓" : ""}</td>
                <td><b>{p.cashOut !== "" ? money(p.cashOut) : ""}</b></td>
                <td className={balance === null ? "" : balance > 0 ? "pos" : balance < 0 ? "neg" : ""}><b>{balance === null ? "" : `${balance > 0 ? "+" : ""}${money(balance)}`}</b></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PlayerPicker({ mode, players, onPick, onClose }: { mode: string; players: Player[]; onPick: (name: string) => void; onClose: () => void }) {
  const title = mode === "buyin" ? "Select Buy-In Player" : mode === "cashout" ? "Select Cash-Out Player" : "Select Host Fee Player";
  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="player-grid">
        {players.map((p) => <button key={p.name} className={`player-btn ${p.color}`} onClick={() => onPick(p.name)}>{p.name}</button>)}
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className={wide ? "modal wide" : "modal"} initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}>
        <div className="modal-head"><h2>{title}</h2><button onClick={onClose}><X /></button></div>
        <div className="modal-body">{children}</div>
      </motion.div>
    </motion.div>
  );
}
