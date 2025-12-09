import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { ApiError } from './errorHandler';

const prisma = new PrismaClient();

declare global {
  namespace Express {
    interface Request {
      apiKey?: {
        id: string;
        userId?: string;
        permissions: string[];
      };
    }
  }
}

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Missing or invalid Authorization header');
    }

    const apiKeyValue = authHeader.substring(7); // Remove "Bearer "

    const apiKey = await prisma.apiKey.findUnique({
      where: { key: apiKeyValue },
    });

    if (!apiKey || !apiKey.active) {
      throw new ApiError(401, 'INVALID_API_KEY', 'API key is invalid or inactive');
    }

    // Update last used timestamp
    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });

    // Attach API key info to request
    req.apiKey = {
      id: apiKey.id,
      userId: apiKey.userId || undefined,
      permissions: apiKey.permissions as string[],
    };

    next();
  } catch (error) {
    next(error);
  }
};

export const requirePermission = (permission: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.apiKey) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
    }

    if (!req.apiKey.permissions.includes(permission) && !req.apiKey.permissions.includes('*')) {
      throw new ApiError(403, 'FORBIDDEN', `Missing required permission: ${permission}`);
    }

    next();
  };
};
