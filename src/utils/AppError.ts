export class AppError extends Error {
  public readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
  }

  static badRequest(message = 'Bad request') {
    return new AppError(400, message);
  }
  static unauthorized(message = 'Unauthorized') {
    return new AppError(401, message);
  }
  static forbidden(message = 'Forbidden') {
    return new AppError(403, message);
  }
  static notFound(message = 'Not found') {
    return new AppError(404, message);
  }
  static conflict(message = 'Conflict') {
    return new AppError(409, message);
  }
}
