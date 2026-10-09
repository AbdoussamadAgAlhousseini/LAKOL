import type { Permission } from "./permissions";

type BasePermission = Permission extends infer P ? (P extends `${infer B}:own` ? B : P) : never;

/** Ce qu'un utilisateur peut faire dans l'espace actif, et sur quoi. */
export interface AccessScope {
  permissions: ReadonlySet<string>;
  /** Classes du professeur (affectations + classes dont il est principal). */
  classIds: ReadonlySet<string>;
  /** Élèves accessibles en périmètre `:own` (enfants, soi-même, élèves des classes du prof). */
  studentIds: ReadonlySet<string>;
}

export class ForbiddenError extends Error {
  constructor(message = "Accès refusé") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** A la permission, sur toute l'école ou sur son périmètre. */
export function can(scope: AccessScope, permission: BasePermission): boolean {
  return scope.permissions.has(permission) || scope.permissions.has(`${permission}:own`);
}

/** A la permission sur toute l'école (pas seulement son périmètre). */
export function canAll(scope: AccessScope, permission: BasePermission): boolean {
  return scope.permissions.has(permission);
}

export function canOnClass(scope: AccessScope, permission: BasePermission, classId: string): boolean {
  if (scope.permissions.has(permission)) return true;
  return scope.permissions.has(`${permission}:own`) && scope.classIds.has(classId);
}

export function canOnStudent(scope: AccessScope, permission: BasePermission, studentId: string): boolean {
  if (scope.permissions.has(permission)) return true;
  return scope.permissions.has(`${permission}:own`) && scope.studentIds.has(studentId);
}

export function requirePermission(scope: AccessScope, permission: BasePermission): void {
  if (!can(scope, permission)) throw new ForbiddenError();
}

export function requireClassAccess(scope: AccessScope, permission: BasePermission, classId: string): void {
  if (!canOnClass(scope, permission, classId)) throw new ForbiddenError();
}

export function requireStudentAccess(scope: AccessScope, permission: BasePermission, studentId: string): void {
  if (!canOnStudent(scope, permission, studentId)) throw new ForbiddenError();
}
