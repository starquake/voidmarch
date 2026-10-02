/** The banner when the Kla'ed Dreadnought falls (#125): what it opened, and the part this player won, if any. */
export function bossFellBanner(part: string | undefined): string[] {
  const lines = ["The Kla'ed Dreadnought has fallen", 'Rings 2 and 3 are open.'];
  if (part !== undefined) {
    lines.push(`Your reward: ${part}`);
  }

  return lines;
}

/**
 * The banner when the open rings close again (#125), or undefined for any
 * other change: the first frontier a client hears, or rings opening.
 */
export function ringsClosedBanner(before: number, after: number): string[] | undefined {
  if (before < 2 || after >= before) {
    return undefined;
  }

  return ['Rings 2 and 3 have closed', 'Ring 1 fell below 4 cleared sectors. Take them back to wake a new Dreadnought.'];
}
