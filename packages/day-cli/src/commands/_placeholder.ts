/**
 * Shared placeholder runner for S2 stub commands.
 *
 * Every system command in S2 has a real `--help` contract but no behavior
 * yet. Running one prints a clear "not yet implemented" message and exits 0
 * (intentional, not an error). Future slices replace `run` per command while
 * keeping the same `Command` shape.
 */

export function placeholderRun(name: string, tracking: string): () => number {
  return () => {
    console.log(`scaffold-day ${name}: not yet implemented (placeholder).`);
    console.log(`Run \`scaffold-day ${name} --help\` to see the contract.`);
    console.log(`Tracking: ${tracking}`);
    return 0;
  };
}
