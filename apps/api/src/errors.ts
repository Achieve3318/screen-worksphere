import type { FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { errorCodes } from '@screenvault/types'

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function unauthorized(message = 'Authentication is required.'): ApiError {
  return new ApiError(401, errorCodes.UNAUTHORIZED, message)
}

export function forbidden(message = 'You do not have access to this resource.'): ApiError {
  return new ApiError(403, errorCodes.FORBIDDEN, message)
}

export function notFound(message = 'Resource not found.'): ApiError {
  return new ApiError(404, errorCodes.NOT_FOUND, message)
}

function validationMessage(error: ZodError): string {
  const messages = error.issues.map((issue) => {
    const field = String(issue.path[0] ?? '')
    if (field === 'password') {
      return 'Password must be at least 10 characters and include a letter and a number.'
    }
    if (field === 'email') return 'Enter a valid email address.'
    if (field === 'name') return 'Enter a name.'
    if (field === 'teamId') return 'Select a team.'
    return issue.message
  })
  return [...new Set(messages)].join(' ')
}

export function sendError(reply: FastifyReply, request: FastifyRequest, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      error: {
        code: errorCodes.VALIDATION_ERROR,
        message: validationMessage(error),
        details: error.flatten(),
        requestId: request.id,
      },
    })
  }
  if (error instanceof ApiError) {
    return reply.code(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        requestId: request.id,
      },
    })
  }
  const statusCode =
    typeof error === 'object' &&
    error &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
      ? error.statusCode
      : 500
  if (statusCode === 413) {
    return reply.code(413).send({
      error: {
        code: errorCodes.PAYLOAD_TOO_LARGE,
        message: 'Upload exceeds the size limit.',
        requestId: request.id,
      },
    })
  }
  if (statusCode === 429) {
    return reply.code(429).send({
      error: {
        code: errorCodes.RATE_LIMITED,
        message: 'Too many requests. Try again shortly.',
        requestId: request.id,
      },
    })
  }
  request.log.error({ err: error, requestId: request.id }, 'unhandled error')
  return reply.code(500).send({
    error: {
      code: 'INTERNAL',
      message: 'Something went wrong.',
      requestId: request.id,
    },
  })
}
