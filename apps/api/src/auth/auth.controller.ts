import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import type { Env } from '../config/env.js';
import type { AuthContext } from './auth-context.js';
import {
  AuthConfigDto,
  ChangePasswordDto,
  LoginDto,
  SessionInfoDto,
  SignupDto,
  toSessionInfo,
} from './auth.dto.js';
import { type AuthResult, type ClientContext, AuthService } from './auth.service.js';
import { SESSION_COOKIE, readCookie, sessionCookieOptions } from './cookies.js';
import { AllowPending, CurrentAuth, Public, SessionOnly } from './decorators.js';

function clientOf(request: Request): ClientContext {
  return {
    ip: request.ip ?? 'unknown',
    sessionToken: readCookie(request.headers.cookie, SESSION_COOKIE),
  };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly secureCookie: boolean;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService<Env, true>
  ) {
    this.secureCookie = config.get('PUBLIC_ORIGIN', { infer: true }).startsWith('https://');
  }

  @Public()
  @Get('config')
  @ApiOkResponse({ type: AuthConfigDto })
  config(): Promise<AuthConfigDto> {
    return this.auth.publicConfig();
  }

  @Public()
  @Post('signup')
  @ApiCreatedResponse({ type: SessionInfoDto })
  async signup(
    @Body() dto: SignupDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<SessionInfoDto> {
    return this.respond(response, await this.auth.signup(dto, clientOf(request)));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SessionInfoDto })
  @ApiUnauthorizedResponse({ description: 'Unknown email, wrong password or disabled account' })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<SessionInfoDto> {
    return this.respond(response, await this.auth.login(dto, clientOf(request)));
  }

  @SessionOnly()
  @AllowPending()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) response: Response
  ): Promise<void> {
    await this.auth.logout(auth);
    response.clearCookie(SESSION_COOKIE, sessionCookieOptions(this.secureCookie));
  }

  @AllowPending()
  @Get('me')
  @ApiOkResponse({ type: SessionInfoDto })
  me(@CurrentAuth() auth: AuthContext): SessionInfoDto {
    return toSessionInfo(auth.user, auth.session?.csrfToken ?? null);
  }

  @SessionOnly()
  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: ChangePasswordDto
  ): Promise<void> {
    await this.auth.changePassword(auth, dto);
  }

  private respond(response: Response, result: AuthResult): SessionInfoDto {
    response.cookie(SESSION_COOKIE, result.session.token, {
      ...sessionCookieOptions(this.secureCookie),
      expires: result.session.expiresAt,
    });
    return toSessionInfo(result.user, result.session.csrfToken);
  }
}
