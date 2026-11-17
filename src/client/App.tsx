import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, MouseEvent as ReactMouseEvent } from 'react';
import { context, requestExpandedMode, showToast } from '@devvit/web/client';
import {
  DIRECTION_ARROWS,
  GRID_SIZE,
  generateMaze,
  isValidDateString,
  rotateDirection,
  simulate,
  todayString,
  type Direction,
  type FlowOutcome,
  type LeaderboardEntry,
  type Maze,
  type Pos,
  type SubmitScoreResponse,
  type TodayResponse,
} from '../shared/index.ts';

type Phase = 'playing' | 'flowing' | 'won' | 'lost';

const FLOW_STEP_MS = 240;

function formatDateId(date: string): string {
  try {
    return new Date(`${date}T00:00:00Z`).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return date;
  }
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function outcomeMessage(outcome: FlowOutcome): string {
  switch (outcome) {
    case 'whirlpool':
      return '🌀 Orb tersedot pusaran! Putar lagi arusnya.';
    case 'exit':
      return '💦 Orb hanyut keluar grid! Putar lagi arusnya.';
    case 'loop':
      return '🔁 Orb berputar di tempat! Putar lagi arusnya.';
    case 'goal':
      return '🎉 Orb sampai di Goal!';
  }
}

/** The maze date: the post's date when opened from a daily post, else today. */
function resolveDate(): string {
  try {
    const postData = (context as unknown as { postData?: unknown }).postData;
    if (postData && typeof postData === 'object' && 'date' in postData) {
      const date = (postData as { date: unknown }).date;
      if (typeof date === 'string' && isValidDateString(date) && date <= todayString()) {
        return date;
      }
    }
  } catch {
    // Outside Reddit (local dev) there is no postData — fall through.
  }
  return todayString();
}

function toast(message: string, setLocalToast: (message: string | null) => void): void {
  try {
    showToast(message);
  } catch {
    setLocalToast(message);
    window.setTimeout(() => setLocalToast(null), 3000);
  }
}

export function App(): JSX.Element {
  const [date] = useState<string>(() => resolveDate());
  const [maze] = useState<Maze>(() => generateMaze(date));
  const [arrows, setArrows] = useState<Direction[][]>(() =>
    maze.arrows.map((row) => [...row]),
  );
  const [steps, setSteps] = useState(0);
  const [phase, setPhase] = useState<Phase>('playing');
  const [flowPath, setFlowPath] = useState<Pos[]>([]);
  const [flowIndex, setFlowIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [localToast, setLocalToast] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [streak, setStreak] = useState(0);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [winTimeMs, setWinTimeMs] = useState<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const submittedRef = useRef(false);

  const par = maze.par;
  const orbPos = phase === 'flowing' || phase === 'won' || phase === 'lost'
    ? flowPath[Math.min(flowIndex, flowPath.length - 1)]
    : null;

  // Leaderboard + streak from the server (progressive enhancement: the
  // maze itself renders instantly from the deterministic local seed).
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/day?date=${date}`);
        if (!res.ok) return;
        const data = (await res.json()) as TodayResponse;
        if (cancelled) return;
        setLeaderboard(data.leaderboard);
        setStreak(data.myStreak);
        setMyRank(data.myBest?.rank ?? null);
        setLoggedIn(data.loggedIn);
      } catch {
        // Offline / local dev without the API server: play stays local.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [date]);

  // Live timer while the player is working on the maze.
  useEffect(() => {
    if (phase !== 'playing' || startedAtRef.current === null) return;
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - (startedAtRef.current ?? Date.now()));
    }, 500);
    return () => window.clearInterval(timer);
  }, [phase]);

  // Orb animation: advance one cell per tick until the path ends.
  useEffect(() => {
    if (phase !== 'flowing') return;
    if (flowIndex >= flowPath.length - 1) {
      const outcome = simulate(arrows, maze.whirlpools, maze.start, maze.goal).outcome;
      if (outcome === 'goal') {
        setPhase('won');
      } else {
        setNotice(outcomeMessage(outcome));
        setPhase('lost');
      }
      return;
    }
    const timer = window.setTimeout(() => setFlowIndex((i) => i + 1), FLOW_STEP_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, flowIndex, flowPath]);

  // Submit the winning score once.
  useEffect(() => {
    if (phase !== 'won' || submittedRef.current) return;
    submittedRef.current = true;
    const timeMs = startedAtRef.current === null ? 0 : Date.now() - startedAtRef.current;
    setWinTimeMs(timeMs);
    const submit = async (): Promise<void> => {
      setSubmitting(true);
      try {
        const res = await fetch('/api/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, steps, timeMs }),
        });
        const data = (await res.json()) as SubmitScoreResponse;
        if (data.ok) {
          setStreak(data.streak);
          setMyRank(data.rank);
          // Refresh the leaderboard to show the new entry.
          const dayRes = await fetch(`/api/day?date=${date}`);
          if (dayRes.ok) {
            const day = (await dayRes.json()) as TodayResponse;
            setLeaderboard(day.leaderboard);
          }
        } else if (data.error === 'LOGIN_REQUIRED') {
          setNotice('Login dulu di Reddit untuk menyimpan skor & streak kamu.');
        } else {
          setNotice(`Skor tidak tersimpan: ${data.error ?? 'error'}`);
        }
      } catch {
        setNotice('Skor tidak tersimpan (server tidak terjangkau) — tetap tercatat lokal.');
      } finally {
        setSubmitting(false);
      }
    };
    void submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const handleTap = useCallback(
    (row: number, col: number) => {
      if (phase !== 'playing') return;
      if (maze.whirlpools[row][col]) return; // Whirlpools have no arrow.
      if (startedAtRef.current === null) startedAtRef.current = Date.now();
      setArrows((prev) => {
        const next = prev.map((r) => [...r]);
        next[row][col] = rotateDirection(next[row][col]);
        return next;
      });
      setSteps((s) => s + 1);
      setNotice(null);
    },
    [phase, maze.whirlpools],
  );

  const handleFlow = useCallback(() => {
    if (phase !== 'playing') return;
    const result = simulate(arrows, maze.whirlpools, maze.start, maze.goal);
    setFlowPath(result.path);
    setFlowIndex(0);
    setPhase('flowing');
  }, [phase, arrows, maze]);

  const handleReset = useCallback(() => {
    setArrows(maze.arrows.map((row) => [...row]));
    setSteps(0);
    setPhase('playing');
    setFlowPath([]);
    setFlowIndex(0);
    setNotice(null);
    setElapsedMs(0);
    setWinTimeMs(null);
    startedAtRef.current = null;
    submittedRef.current = false;
  }, [maze]);

  const handleCopyScore = useCallback(async () => {
    const lines = [
      `🌊 Arus Harian — ${formatDateId(date)}`,
      `✅ Selesai dalam ${steps} langkah (par ${par})${winTimeMs !== null ? ` • ⏱ ${formatTime(winTimeMs)}` : ''}`,
      `🔥 Streak ${streak} hari${myRank !== null ? ` • 🏆 Peringkat #${myRank} hari ini` : ''}`,
      'Main di r/arus_harian_dev',
    ];
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    }
    setCopied(true);
    toast('Skor disalin! Bagikan di komentar.', setLocalToast);
    window.setTimeout(() => setCopied(false), 2500);
  }, [date, steps, par, winTimeMs, streak, myRank]);

  const handleExpand = useCallback((event: ReactMouseEvent) => {
    try {
      requestExpandedMode(event.nativeEvent, 'default');
    } catch {
      // Outside Reddit there is no expanded mode — ignore.
    }
  }, []);

  const isToday = useMemo(() => date === todayString(), [date]);
  const orbKey = orbPos ? `${orbPos.row},${orbPos.col}` : null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-950 via-cyan-950 to-teal-950 text-sky-50">
      <div className="mx-auto flex max-w-md flex-col gap-3 px-3 py-4">
        <header className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold tracking-tight">🌊 Arus Harian</h1>
            <p className="text-xs text-sky-300">
              {formatDateId(date)}
              {isToday ? ' • Labirin hari ini' : ' • Labirin arsip'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="rounded-full bg-orange-500/20 px-2 py-1 text-xs font-semibold text-orange-200"
              title="Streak harian"
            >
              🔥 {streak}
            </span>
            <button
              type="button"
              onClick={handleExpand}
              className="rounded-full bg-sky-800 px-2 py-1 text-xs font-semibold text-sky-100 hover:bg-sky-700"
            >
              ⛶ Perbesar
            </button>
          </div>
        </header>

        <p className="text-sm leading-snug text-sky-200">
          Ketuk petak untuk memutar arusnya 90°. Susun arus supaya orb mengalir
          ke 🎯 Goal — hindari 🌀 pusaran dan arus yang keluar grid.
        </p>

        <div
          className="grid aspect-square w-full grid-cols-7 gap-1"
          aria-label="Labirin arus"
        >
          {arrows.map((row, r) =>
            row.map((direction, c) => {
              const isStart = r === maze.start.row && c === maze.start.col;
              const isGoal = r === maze.goal.row && c === maze.goal.col;
              const isWhirlpool = maze.whirlpools[r][c];
              const hasOrb = orbKey === `${r},${c}`;
              return (
                <button
                  key={`${r}-${c}`}
                  type="button"
                  onClick={() => handleTap(r, c)}
                  disabled={phase === 'flowing' || isWhirlpool}
                  aria-label={
                    isWhirlpool
                      ? `Pusaran di baris ${r + 1} kolom ${c + 1}`
                      : `Petak baris ${r + 1} kolom ${c + 1}, arus ${DIRECTION_ARROWS[direction]}`
                  }
                  className={[
                    'cell-pop relative flex aspect-square items-center justify-center rounded-lg text-2xl font-bold transition-colors',
                    isWhirlpool
                      ? 'cursor-not-allowed bg-purple-900/80 text-purple-200'
                      : 'bg-sky-800/70 text-sky-100 hover:bg-sky-700/80 active:bg-sky-600',
                    isStart ? 'ring-2 ring-emerald-400' : '',
                    isGoal ? 'ring-2 ring-amber-400' : '',
                    phase === 'flowing' ? 'pointer-events-none' : '',
                  ].join(' ')}
                >
                  {isWhirlpool ? (
                    <span aria-hidden>🌀</span>
                  ) : (
                    <span aria-hidden>{DIRECTION_ARROWS[direction]}</span>
                  )}
                  {isGoal && !isWhirlpool && (
                    <span className="absolute -right-0.5 -top-0.5 text-[10px]" aria-hidden>
                      🎯
                    </span>
                  )}
                  {isStart && (
                    <span className="absolute -left-0.5 -top-0.5 text-[10px]" aria-hidden>
                      ●
                    </span>
                  )}
                  {hasOrb && (
                    <span
                      className="orb absolute inset-0 m-auto h-5 w-5 rounded-full bg-cyan-300 shadow-[0_0_12px_4px_rgba(103,232,249,0.8)]"
                      aria-hidden
                    />
                  )}
                </button>
              );
            }),
          )}
        </div>

        <div className="flex items-center justify-between text-sm">
          <span>
            Langkah: <strong>{steps}</strong> • Par: <strong>{par}</strong>
          </span>
          <span>⏱ {formatTime(phase === 'won' && winTimeMs !== null ? winTimeMs : elapsedMs)}</span>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleFlow}
            disabled={phase === 'flowing'}
            className="flex-1 rounded-xl bg-cyan-400 px-4 py-2.5 font-bold text-cyan-950 hover:bg-cyan-300 disabled:opacity-50"
          >
            {phase === 'flowing' ? '🌊 Mengalir…' : '▶ Alirkan Orb'}
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={phase === 'flowing'}
            className="rounded-xl bg-sky-800 px-4 py-2.5 font-semibold text-sky-100 hover:bg-sky-700 disabled:opacity-50"
          >
            ↺ Reset
          </button>
        </div>

        {notice && (
          <p className="rounded-xl bg-sky-900/80 px-3 py-2 text-sm text-sky-100">{notice}</p>
        )}

        {phase === 'won' && (
          <section className="rounded-2xl bg-emerald-900/60 p-4" aria-label="Kartu hasil">
            <h2 className="text-lg font-bold text-emerald-100">🎉 Selesai!</h2>
            <p className="mt-1 text-sm text-emerald-100/90">
              {steps} langkah (par {par})
              {winTimeMs !== null ? ` • ⏱ ${formatTime(winTimeMs)}` : ''}
              {myRank !== null ? ` • 🏆 Peringkat #${myRank} hari ini` : ''}
            </p>
            <p className="text-sm text-emerald-100/90">🔥 Streak kamu: {streak} hari</p>
            {submitting && <p className="mt-1 text-xs text-emerald-200/80">Menyimpan skor…</p>}
            <button
              type="button"
              onClick={handleCopyScore}
              className="mt-3 w-full rounded-xl bg-emerald-400 px-4 py-2.5 font-bold text-emerald-950 hover:bg-emerald-300"
            >
              {copied ? '✅ Disalin!' : '📋 Salin Skor'}
            </button>
            <p className="mt-2 text-center text-xs text-emerald-200/70">
              Labirin baru besok — jaga streak kamu!
            </p>
          </section>
        )}

        <section className="rounded-2xl bg-sky-900/60 p-4" aria-label="Leaderboard harian">
          <h2 className="font-bold">🏆 Leaderboard Hari Ini</h2>
          {leaderboard.length === 0 ? (
            <p className="mt-1 text-sm text-sky-300">
              Belum ada yang menyelesaikan labirin hari ini — jadilah yang pertama!
            </p>
          ) : (
            <ol className="mt-2 space-y-1 text-sm">
              {leaderboard.map((entry) => (
                <li
                  key={entry.rank}
                  className={`flex justify-between rounded-lg px-2 py-1 ${
                    myRank === entry.rank ? 'bg-cyan-400/20 font-semibold' : 'bg-sky-950/50'
                  }`}
                >
                  <span>
                    #{entry.rank} {entry.username}
                  </span>
                  <span>
                    {entry.steps} langkah • {formatTime(entry.timeMs)}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {!loggedIn && (
            <p className="mt-2 text-xs text-sky-300">
              Login di Reddit untuk menyimpan skor dan streak kamu.
            </p>
          )}
        </section>

        <details className="rounded-2xl bg-sky-900/40 px-4 py-3 text-sm text-sky-200">
          <summary className="cursor-pointer font-semibold text-sky-100">Cara main</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Orb mulai dari petak hijau (●) dan mengikuti panah arus.</li>
            <li>Ketuk petak untuk memutar arusnya 90° searah jarum jam (1 langkah).</li>
            <li>Capai 🎯 Goal dengan langkah sesedikit mungkin — par hari ini {par}.</li>
            <li>🌀 pusaran menelan orb; panah yang keluar grid menghanyutkannya.</li>
            <li>Main tiap hari untuk menjaga streak 🔥 dan masuk top 10.</li>
          </ul>
        </details>

        {localToast && (
          <p className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
            {localToast}
          </p>
        )}
      </div>
    </div>
  );
}
