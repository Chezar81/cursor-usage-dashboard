/**
 * Minimal runtime stand-in for the `vscode` module so pure modules can be
 * bundled and run under plain Node tests. Only the surface used at runtime
 * by the tested modules is implemented.
 */
export class Uri {
  private constructor(
    public readonly scheme: string,
    public readonly path: string
  ) {}

  static parse(value: string): Uri {
    const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/.exec(value);
    if (!match) {
      throw new Error(`Invalid Uri: ${value}`);
    }
    let rest = match[2];
    if (rest.startsWith("//")) {
      const slash = rest.indexOf("/", 2);
      rest = slash >= 0 ? rest.slice(slash) : "/";
    }
    return new Uri(match[1], decodeURIComponent(rest));
  }

  with(change: { path?: string }): Uri {
    return new Uri(this.scheme, change.path ?? this.path);
  }

  get fsPath(): string {
    return this.path;
  }

  toString(): string {
    return `${this.scheme}://${encodeURI(this.path).replace(/#/g, "%23")}`;
  }
}

export const workspace = {
  workspaceFolders: undefined,
  getConfiguration: () => ({
    get: (_key: string, fallback: unknown) => fallback,
    update: async () => undefined,
  }),
};

export const window = {
  state: { focused: true },
};

export const env = { sessionId: "test-session" };
