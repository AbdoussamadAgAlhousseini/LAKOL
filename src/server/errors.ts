/**
 * Erreur métier attendue (doublon, classe pleine, données liées…). Le code
 * est une clé de traduction affichée telle quelle à l'utilisateur
 * (messages « errors.<code> »).
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    public readonly field?: string,
  ) {
    super(code);
    this.name = "DomainError";
  }
}

export class NotFoundError extends DomainError {
  constructor() {
    super("notFound");
    this.name = "NotFoundError";
  }
}
