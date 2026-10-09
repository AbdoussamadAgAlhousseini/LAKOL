import "server-only";
import { DomainError } from "@/server/errors";
import { canAll, ForbiddenError } from "@/server/rbac/policies";
import { addDays } from "@/lib/time";
import { paginate, type ServiceContext } from "../context";
import { found } from "../structure";

export const LOAN_DAYS = 14;

function requireLibrarian(ctx: ServiceContext) {
  if (!canAll(ctx.scope, "library.manage")) throw new ForbiddenError();
}

/** Catalogue, avec le nombre d'exemplaires disponibles. */
export async function listBooks(ctx: ServiceContext, filters: { q?: string; page?: number }) {
  requireLibrarian(ctx);
  const { skip, take, page } = paginate(filters.page);
  const where = {
    deletedAt: null,
    ...(filters.q
      ? {
          OR: [
            { title: { contains: filters.q, mode: "insensitive" as const } },
            { author: { contains: filters.q, mode: "insensitive" as const } },
            { isbn: { contains: filters.q } },
          ],
        }
      : {}),
  };
  const [books, total] = await Promise.all([
    ctx.db.book.findMany({
      where,
      include: { _count: { select: { loans: { where: { returnedAt: null } } } } },
      orderBy: { title: "asc" },
      skip,
      take,
    }),
    ctx.db.book.count({ where }),
  ]);
  return {
    items: books.map((b) => ({ ...b, available: b.copies - b._count.loans })),
    total,
    page,
  };
}

export async function saveBook(
  ctx: ServiceContext,
  input: {
    id?: string;
    title: string;
    author?: string | null;
    isbn?: string | null;
    category?: string | null;
    copies: number;
    location?: string | null;
  },
) {
  requireLibrarian(ctx);
  const data = {
    title: input.title,
    author: input.author ?? null,
    isbn: input.isbn ?? null,
    category: input.category ?? null,
    copies: input.copies,
    location: input.location ?? null,
  };
  if (input.id) {
    const book = await found(ctx.db.book.findFirst({ where: { id: input.id, deletedAt: null } }));
    const out = await ctx.db.bookLoan.count({ where: { bookId: book.id, returnedAt: null } });
    if (input.copies < out) throw new DomainError("copiesOnLoan", "copies");
    return ctx.db.book.update({ where: { id: book.id }, data });
  }
  return ctx.db.book.create({ data: { schoolId: ctx.school.id, ...data } });
}

/** Prêt à un élève ou à un membre du personnel ; refusé s'il ne reste aucun exemplaire. */
export async function lendBook(
  ctx: ServiceContext,
  input: { bookId: string; studentId?: string | null; staffId?: string | null; days?: number },
) {
  requireLibrarian(ctx);
  if (!input.studentId === !input.staffId) throw new DomainError("borrowerRequired", "studentId");
  const book = await found(ctx.db.book.findFirst({ where: { id: input.bookId, deletedAt: null } }));
  if (input.studentId) await found(ctx.db.student.findFirst({ where: { id: input.studentId, deletedAt: null } }));
  if (input.staffId) await found(ctx.db.staff.findFirst({ where: { id: input.staffId, deletedAt: null } }));
  const out = await ctx.db.bookLoan.count({ where: { bookId: book.id, returnedAt: null } });
  if (out >= book.copies) throw new DomainError("noCopyAvailable", "bookId");
  return ctx.db.bookLoan.create({
    data: {
      schoolId: ctx.school.id,
      bookId: book.id,
      studentId: input.studentId ?? null,
      staffId: input.staffId ?? null,
      dueAt: addDays(new Date(), input.days ?? LOAN_DAYS),
    },
  });
}

export async function returnBook(ctx: ServiceContext, loanId: string) {
  requireLibrarian(ctx);
  const loan = await found(ctx.db.bookLoan.findUnique({ where: { id: loanId } }));
  if (loan.returnedAt) throw new DomainError("alreadyReturned");
  await ctx.db.bookLoan.update({ where: { id: loan.id }, data: { returnedAt: new Date() } });
}

/** Prêts en cours, les retards en premier. */
export async function openLoans(ctx: ServiceContext) {
  requireLibrarian(ctx);
  return ctx.db.bookLoan.findMany({
    where: { returnedAt: null },
    include: { book: true, student: true, staff: true },
    orderBy: { dueAt: "asc" },
  });
}
