import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import { ApiError } from './errorHandler';

/**
 * Middleware factory for Zod validation
 *
 * Usage:
 * router.post('/endpoint', validate(mySchema), controller)
 */
export function validate(schema: AnyZodObject) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate request body
      req.body = await schema.parseAsync(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // Format Zod errors nicely
        const formattedErrors = error.errors.map((err) => ({
          path: err.path.join('.'),
          message: err.message,
        }));

        next(
          new ApiError(
            400,
            'VALIDATION_ERROR',
            'Request validation failed',
            formattedErrors
          )
        );
      } else {
        next(error);
      }
    }
  };
}

/**
 * Validate query parameters
 */
export function validateQuery(schema: AnyZodObject) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      req.query = await schema.parseAsync(req.query);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = error.errors.map((err) => ({
          path: err.path.join('.'),
          message: err.message,
        }));

        next(
          new ApiError(
            400,
            'VALIDATION_ERROR',
            'Query parameter validation failed',
            formattedErrors
          )
        );
      } else {
        next(error);
      }
    }
  };
}

/**
 * Validate URL parameters
 */
export function validateParams(schema: AnyZodObject) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      req.params = await schema.parseAsync(req.params);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = error.errors.map((err) => ({
          path: err.path.join('.'),
          message: err.message,
        }));

        next(
          new ApiError(
            400,
            'VALIDATION_ERROR',
            'URL parameter validation failed',
            formattedErrors
          )
        );
      } else {
        next(error);
      }
    }
  };
}
