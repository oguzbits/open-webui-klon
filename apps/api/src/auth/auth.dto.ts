import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

import { emailTransform } from '../users/email.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../users/password-policy.js';
import { toUserDto, trimTransform, UserDto } from '../users/users.dto.js';
import type { User } from '../users/user.entity.js';

export class SignupDto {
  @Transform(emailTransform)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Transform(trimTransform)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

export class LoginDto {
  @Transform(emailTransform)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  // No minimum here: the login must not reveal the password rules, and old passwords may be shorter.
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword!: string;
}

export class SessionInfoDto {
  user!: UserDto;

  /** Sent back as X-CSRF-Token on writing requests; null for API-key calls (they need none). */
  @ApiProperty({ type: String, nullable: true })
  csrfToken!: string | null;
}

export function toSessionInfo(user: User, csrfToken: string | null): SessionInfoDto {
  return { user: toUserDto(user), csrfToken };
}

export class AuthConfigDto {
  /** The sign-up form may be shown. Always true while no account exists. */
  signupEnabled!: boolean;
  /** No account exists yet: the next sign-up becomes the admin. */
  onboarding!: boolean;
  apiKeysEnabled!: boolean;
}
