import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tables } from '../config/aws';
import { AppError } from '../utils/AppError';
import { signToken } from '../middleware/auth';
import type { PublicUser, Role, User } from '../types';
import { nowIso, scanAll } from './db';

const SALT_ROUNDS = 10;

export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _omit, ...rest } = user;
  return rest;
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const out = await ddb.send(
    new QueryCommand({
      TableName: tables.users,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email.trim().toLowerCase() },
      Limit: 1,
    }),
  );
  return out.Items?.[0] as User | undefined;
}

export async function getUserById(userId: string): Promise<User | undefined> {
  const out = await ddb.send(new GetCommand({ TableName: tables.users, Key: { userId } }));
  return out.Item as User | undefined;
}

export async function requireUser(userId: string): Promise<User> {
  const user = await getUserById(userId);
  if (!user) throw AppError.notFound('User not found');
  return user;
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: Role;
  phone?: string;
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const email = input.email.trim().toLowerCase();
  // Note: GSIs are eventually consistent and can't enforce uniqueness; acceptable for the
  // prototype. For production, add a conditional put on an `EMAIL#<email>` guard item.
  if (await findUserByEmail(email)) {
    throw AppError.conflict('Email is already registered');
  }
  const user: User = {
    userId: randomUUID(),
    name: input.name.trim(),
    email,
    passwordHash: await bcrypt.hash(input.password, SALT_ROUNDS),
    role: input.role,
    phone: input.phone,
    createdAt: nowIso(),
  };
  await ddb.send(
    new PutCommand({
      TableName: tables.users,
      Item: user,
      ConditionExpression: 'attribute_not_exists(userId)',
    }),
  );
  return user;
}

export async function register(input: CreateUserInput) {
  const user = await createUser(input);
  return { token: signToken(user), user: toPublicUser(user) };
}

export async function login(email: string, password: string) {
  const user = await findUserByEmail(email);
  // Same message for unknown email and wrong password to avoid account enumeration.
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw AppError.unauthorized('Invalid email or password');
  }
  return { token: signToken(user), user: toPublicUser(user) };
}

export async function listUsersByRole(role: Role): Promise<PublicUser[]> {
  const users = await scanAll<User>({
    TableName: tables.users,
    FilterExpression: '#role = :role',
    ExpressionAttributeNames: { '#role': 'role' },
    ExpressionAttributeValues: { ':role': role },
  });
  return users.map(toPublicUser);
}
