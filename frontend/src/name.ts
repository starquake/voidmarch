/** The longest name, matching the server. */
export const MAX_NAME_LENGTH = 16;

const NAME = /^[\p{L}\p{N} _-]+$/u;

/** Why a name can't be used, or undefined when it's fine; spaces around it are ignored. */
export function nameProblem(raw: string): string | undefined {
  const name = raw.trim();
  if (name === '') {
    return 'Pick a name first.';
  }
  // Code points, like the server's utf8.RuneCountInString, so both agree on the limit.
  if (Array.from(name).length > MAX_NAME_LENGTH) {
    return `A name is at most ${MAX_NAME_LENGTH} characters.`;
  }
  if (!NAME.test(name)) {
    return 'Use letters, digits, spaces, - or _.';
  }

  return undefined;
}

/** Registers a name with the server and returns the player's token. */
export async function register(name: string, fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher('/api/players', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim() }),
  });
  const body = (await response.json()) as { token?: string; error?: string };
  if (!response.ok || body.token === undefined) {
    throw new RegisterError(body.error ?? `The server said ${response.status}.`);
  }

  return body.token;
}

/** A refusal the player can act on, such as a name the server won't take. */
export class RegisterError extends Error {
  override name = 'RegisterError';
}

/**
 * Shows the name screen and resolves with a token, or with undefined when the
 * server can't be reached and the player chooses to play alone.
 */
export function askName(): Promise<string | undefined> {
  const form = document.querySelector<HTMLFormElement>('#name-form');
  const input = document.querySelector<HTMLInputElement>('#name');
  const error = document.querySelector<HTMLElement>('#name-error');
  const alone = document.querySelector<HTMLButtonElement>('#play-alone');
  if (form === null || input === null || error === null || alone === null) {
    return Promise.resolve(undefined);
  }

  form.hidden = false;
  input.focus();

  return new Promise((resolve) => {
    const done = (token: string | undefined): void => {
      form.hidden = true;
      resolve(token);
    };
    alone.addEventListener('click', () => {
      done(undefined);
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const problem = nameProblem(input.value);
      if (problem !== undefined) {
        error.textContent = problem;

        return;
      }
      error.textContent = '';
      register(input.value)
        .then(done)
        .catch((err: unknown) => {
          error.textContent =
            err instanceof RegisterError ? err.message : "Can't reach the server. Try again, or play alone for now.";
          alone.hidden = false;
        });
    });
  });
}
