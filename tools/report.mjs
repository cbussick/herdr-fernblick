import { formatWithOptions } from "node:util";

/** Write human-readable CLI progress/results to stdout, never application data.
 * @param {...unknown} values
 */
export function report(...values) {
  process.stdout.write(
    formatWithOptions({ colors: Boolean(process.stdout.isTTY) }, ...values) + "\n",
  );
}

/** Write CLI failures/diagnostics to stderr without mixing them into results.
 * @param {...unknown} values
 */
export function reportError(...values) {
  process.stderr.write(
    formatWithOptions({ colors: Boolean(process.stderr.isTTY) }, ...values) + "\n",
  );
}
