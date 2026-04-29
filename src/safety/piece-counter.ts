/**
 * Exact piece-count cap. No dollar estimation — every value tracked here is
 * the literal number of mail pieces the caller is requesting.
 *
 * Single-process Node JS — read-then-write is safe across non-await boundaries.
 * checkAndReserve does NOT mutate state; record() does, after a successful commit.
 */
import { LobMcpError, LobMcpErrorCodes } from "../lob/errors.js";

export class PieceCounter {
  private sent = 0;

  constructor(private readonly cap: number | null) {}

  /** Throws LobMcpError if the proposed delta would exceed the cap. */
  checkAndReserve(pieces: number): void {
    if (this.cap == null) return;
    if (this.sent + pieces > this.cap) {
      throw new LobMcpError(
        LobMcpErrorCodes.PIECE_CAP_EXCEEDED,
        `Sending ${pieces} more piece(s) would exceed LOB_MAX_PIECES_PER_RUN (${this.cap}). ` +
          `Sent so far this run: ${this.sent}.`,
        "Restart the server (counter resets) or raise LOB_MAX_PIECES_PER_RUN.",
      );
    }
  }

  record(pieces: number): void {
    this.sent += pieces;
  }

  state(): { sent: number; cap: number | null } {
    return { sent: this.sent, cap: this.cap };
  }
}
