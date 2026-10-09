/* Données de démonstration LAKOL.
 *
 * - « Complexe Scolaire Les Étoiles » (Bamako) : 4 classes, 30 élèves, profs,
 *   parents, emploi du temps, devoirs, présences, notes, frais et paiements.
 * - « École Le Savoir » (Sikasso) : petite école servant aux tests d'isolation.
 *
 * Comptes : voir README.md (section « Comptes de démonstration »).
 * Le seed est déterministe (générateur pseudo-aléatoire à graine fixe).
 */
import { PrismaClient, type Class, type Gender, type Prisma } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  ROLE_NAMES,
  SYSTEM_ROLES,
  type SystemRole,
} from "../src/server/rbac/permissions";

const prisma = new PrismaClient();

// ── Utilitaires ────────────────────────────────────────────────────────────

let seed = 20251001;
function rand(): number {
  seed = (seed * 1103515245 + 12345) % 2 ** 31;
  return seed / 2 ** 31;
}
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
const between = (min: number, max: number) => Math.floor(min + rand() * (max - min + 1));

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 };
const passwordCache = new Map<string, string>();
async function pwd(plain: string) {
  if (!passwordCache.has(plain)) passwordCache.set(plain, await hash(plain, ARGON));
  return passwordCache.get(plain)!;
}

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86_400_000);
}
function today() {
  const t = new Date();
  t.setUTCHours(0, 0, 0, 0);
  return t;
}
/** Derniers jours ouvrés (lundi-vendredi) avant aujourd'hui inclus. */
function lastSchoolDays(count: number): Date[] {
  const days: Date[] = [];
  let cursor = today();
  while (days.length < count) {
    const wd = cursor.getUTCDay();
    if (wd !== 0 && wd !== 6) days.push(cursor);
    cursor = addDays(cursor, -1);
  }
  return days;
}

const MALE = [
  "Moussa",
  "Mamadou",
  "Seydou",
  "Bakary",
  "Oumar",
  "Ibrahim",
  "Souleymane",
  "Adama",
  "Boubacar",
  "Modibo",
  "Cheick",
  "Yacouba",
  "Drissa",
  "Lassana",
  "Sidiki",
];
const FEMALE = [
  "Aminata",
  "Fatoumata",
  "Mariam",
  "Awa",
  "Kadiatou",
  "Oumou",
  "Assitan",
  "Rokia",
  "Djeneba",
  "Hawa",
  "Salimata",
  "Bintou",
  "Nana",
  "Korotoumou",
  "Ramata",
];
const LAST = [
  "Traoré",
  "Coulibaly",
  "Diarra",
  "Keïta",
  "Konaté",
  "Sangaré",
  "Dembélé",
  "Touré",
  "Cissé",
  "Sidibé",
  "Maïga",
  "Diallo",
  "Doumbia",
  "Samaké",
  "Kanté",
];

// ── Plateforme ─────────────────────────────────────────────────────────────

async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  if (list) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}

async function seedPlatform() {
  await prisma.permission.createMany({
    data: Object.entries(PERMISSIONS).map(([key, p]) => ({ key, module: p.module, description: p.description })),
  });
  const ALL_MODULES = [
    "HOMEWORK",
    "ATTENDANCE",
    "GRADES",
    "FINANCE",
    "MESSAGING",
    "TIMETABLE",
    "RESOURCES",
    "CANTEEN",
    "TRANSPORT",
    "LIBRARY",
    "INFIRMARY",
    "INVENTORY",
  ] as const;
  const plans = {
    FREE: await prisma.plan.create({
      data: {
        code: "FREE",
        name: "Essai",
        maxStudents: 50,
        whatsappQuota: 200,
        pricePerStudent: 0,
        modules: ["HOMEWORK", "ATTENDANCE", "GRADES"],
      },
    }),
    STANDARD: await prisma.plan.create({
      data: {
        code: "STANDARD",
        name: "Standard",
        maxStudents: 800,
        whatsappQuota: 3000,
        pricePerStudent: 2500,
        modules: ["HOMEWORK", "ATTENDANCE", "GRADES", "FINANCE", "MESSAGING", "TIMETABLE", "RESOURCES"],
      },
    }),
    PREMIUM: await prisma.plan.create({
      data: {
        code: "PREMIUM",
        name: "Premium",
        maxStudents: null,
        whatsappQuota: 20000,
        pricePerStudent: 4000,
        modules: [...ALL_MODULES],
      },
    }),
  };
  await prisma.user.create({
    data: {
      email: "admin@lakol.test",
      firstName: "Super",
      lastName: "Admin",
      isPlatformAdmin: true,
      passwordHash: await pwd("Admin2025!"),
    },
  });
  return plans;
}

// ── École ──────────────────────────────────────────────────────────────────

type Ctx = {
  schoolId: string;
  roles: Record<SystemRole, string>;
  prefix: string;
};

async function createSchool(data: Prisma.SchoolCreateInput, planId: string, prefix: string): Promise<Ctx> {
  const school = await prisma.school.create({ data: { onboardingDoneAt: new Date(), ...data } });
  const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
  await prisma.subscription.create({
    data: {
      schoolId: school.id,
      planId,
      status: "ACTIVE",
      // Période en cours quelle que soit la date du seed (le cycle de vie ne la passe pas en impayé).
      currentPeriodStart: addDays(new Date(), -60),
      currentPeriodEnd: addDays(new Date(), 305),
    },
  });
  await prisma.moduleActivation.createMany({ data: plan.modules.map((module) => ({ schoolId: school.id, module })) });

  const roles = {} as Record<SystemRole, string>;
  for (const key of SYSTEM_ROLES) {
    const role = await prisma.role.create({
      data: { schoolId: school.id, key, name: ROLE_NAMES[key], isSystem: true },
    });
    roles[key] = role.id;
    await prisma.rolePermission.createMany({
      data: DEFAULT_ROLE_PERMISSIONS[key].map((permissionKey) => ({
        schoolId: school.id,
        roleId: role.id,
        permissionKey,
      })),
    });
  }
  await prisma.campus.create({
    data: { schoolId: school.id, name: "Site principal", isMain: true, address: data.address },
  });
  return { schoolId: school.id, roles, prefix };
}

async function grant(ctx: Ctx, userId: string, ...keys: SystemRole[]) {
  await prisma.userRole.createMany({
    data: keys.map((k) => ({ schoolId: ctx.schoolId, userId, roleId: ctx.roles[k] })),
    skipDuplicates: true,
  });
}

async function createYear(ctx: Ctx) {
  const year = await prisma.academicYear.create({
    data: {
      schoolId: ctx.schoolId,
      name: "2025-2026",
      startDate: d("2025-10-01"),
      endDate: d("2026-06-30"),
      isActive: true,
    },
  });
  const terms = [];
  const ranges = [
    ["1er trimestre", "2025-10-01", "2025-12-20"],
    ["2e trimestre", "2026-01-05", "2026-03-28"],
    ["3e trimestre", "2026-04-07", "2026-06-30"],
  ];
  for (const [i, [name, start, end]] of ranges.entries()) {
    terms.push(
      await prisma.term.create({
        data: {
          schoolId: ctx.schoolId,
          academicYearId: year.id,
          name,
          order: i + 1,
          startDate: d(start),
          endDate: d(end),
        },
      }),
    );
  }
  return { year, terms };
}

let phoneSeq = 0;
function nextPhone() {
  phoneSeq += 1;
  return `+2237600${String(phoneSeq).padStart(4, "0")}`;
}

async function createStaffMember(
  ctx: Ctx,
  input: {
    firstName: string;
    lastName: string;
    gender: Gender;
    position: string;
    email?: string;
    phone?: string;
    roles: SystemRole[];
    salary?: number;
    hourly?: number;
  },
) {
  const user = await prisma.user.create({
    data: {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email ?? null,
      phone: input.phone ?? nextPhone(),
      passwordHash: await pwd("Lakol2025!"),
    },
  });
  await grant(ctx, user.id, ...input.roles);
  const staff = await prisma.staff.create({
    data: {
      schoolId: ctx.schoolId,
      userId: user.id,
      firstName: input.firstName,
      lastName: input.lastName,
      gender: input.gender,
      phone: user.phone,
      email: user.email,
      position: input.position,
      contractType: input.hourly ? "HOURLY" : "PERMANENT",
      monthlySalary: input.salary ?? null,
      hourlyRate: input.hourly ?? null,
      hireDate: d("2020-09-15"),
      diplomas: [{ title: "Licence", year: 2015, institution: "Université de Bamako" }],
    },
  });
  return { user, staff };
}

async function nextMatricule(ctx: Ctx) {
  const c = await prisma.counter.upsert({
    where: { schoolId_key: { schoolId: ctx.schoolId, key: "matricule:2025" } },
    create: { schoolId: ctx.schoolId, key: "matricule:2025", value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${ctx.prefix}-25-${String(c.value).padStart(4, "0")}`;
}

async function createStudent(
  ctx: Ctx,
  input: {
    firstName: string;
    lastName: string;
    gender: Gender;
    birthYear: number;
    classId: string;
    yearId: string;
    withAccount: boolean;
  },
) {
  const matricule = await nextMatricule(ctx);
  let userId: string | null = null;
  if (input.withAccount) {
    const user = await prisma.user.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        username: matricule.toLowerCase(),
        passwordHash: await pwd("Eleve2025!"),
      },
    });
    userId = user.id;
    await grant(ctx, user.id, "STUDENT");
  }
  const student = await prisma.student.create({
    data: {
      schoolId: ctx.schoolId,
      userId,
      accountEnabled: input.withAccount,
      matricule,
      firstName: input.firstName,
      lastName: input.lastName,
      gender: input.gender,
      birthDate: d(
        `${input.birthYear}-${String(between(1, 12)).padStart(2, "0")}-${String(between(1, 28)).padStart(2, "0")}`,
      ),
      birthPlace: pick(["Bamako", "Kati", "Ségou", "Sikasso", "Koulikoro"]),
      nationality: "Malienne",
      bloodGroup: pick(["A+", "B+", "O+", "AB+", "O-", null]),
      allergies: rand() < 0.15 ? "Arachides" : null,
      emergencyContacts: [{ name: "Contact d'urgence", phone: nextPhone(), relationship: "Oncle" }],
    },
  });
  await prisma.enrollment.create({
    data: {
      schoolId: ctx.schoolId,
      studentId: student.id,
      classId: input.classId,
      academicYearId: input.yearId,
      enrolledAt: d("2025-09-20"),
    },
  });
  return student;
}

async function createGuardian(
  ctx: Ctx,
  input: {
    firstName: string;
    lastName: string;
    phone: string;
    email?: string;
    existingUserId?: string;
    password?: string;
  },
) {
  const userId =
    input.existingUserId ??
    (
      await prisma.user.create({
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          email: input.email ?? null,
          passwordHash: await pwd(input.password ?? "Parent2025!"),
        },
      })
    ).id;
  await grant(ctx, userId, "PARENT");
  return prisma.guardian.create({
    data: {
      schoolId: ctx.schoolId,
      userId,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      email: input.email,
      profession: pick(["Commerçant", "Enseignant", "Infirmière", "Fonctionnaire", "Mécanicien", "Couturière"]),
    },
  });
}

async function link(
  ctx: Ctx,
  studentId: string,
  guardianId: string,
  relationship: "FATHER" | "MOTHER" | "LEGAL_GUARDIAN",
  isPrimary = true,
) {
  await prisma.studentGuardian.create({
    data: { schoolId: ctx.schoolId, studentId, guardianId, relationship, isPrimary },
  });
}

// ── École de démonstration principale ─────────────────────────────────────

async function seedEtoiles(planId: string) {
  const ctx = await createSchool(
    {
      slug: "les-etoiles",
      name: "Complexe Scolaire Les Étoiles",
      shortName: "Les Étoiles",
      city: "Bamako",
      address: "Hamdallaye ACI 2000, Bamako",
      phone: "+22320220000",
      email: "contact@les-etoiles.lakol.test",
      reportCardHeader: "République du Mali — Un Peuple, Un But, Une Foi\nComplexe Scolaire Les Étoiles",
      primaryColor: "#0F766E",
    },
    planId,
    "ETO",
  );
  const { schoolId } = ctx;
  const { year, terms } = await createYear(ctx);

  // Structure
  const f1 = await prisma.cycle.create({ data: { schoolId, name: "Fondamental 1er cycle", order: 2 } });
  const f2 = await prisma.cycle.create({ data: { schoolId, name: "Fondamental 2e cycle", order: 3 } });
  const lycee = await prisma.cycle.create({ data: { schoolId, name: "Lycée", order: 4 } });
  await prisma.cycle.create({ data: { schoolId, name: "Maternelle", order: 1 } });

  const lv5 = await prisma.level.create({
    data: { schoolId, cycleId: f1.id, name: "5e année", order: 5, studentAccounts: false },
  });
  const lv7 = await prisma.level.create({ data: { schoolId, cycleId: f2.id, name: "7e année", order: 7 } });
  const lv9 = await prisma.level.create({
    data: { schoolId, cycleId: f2.id, name: "9e année", order: 9, nationalExam: "DEF" },
  });
  const lv11 = await prisma.level.create({ data: { schoolId, cycleId: lycee.id, name: "11e", order: 11 } });
  const tse = await prisma.track.create({ data: { schoolId, code: "TSE", name: "Sciences exactes" } });
  await prisma.track.create({ data: { schoolId, code: "TLL", name: "Lettres et langues" } });

  const rooms = await Promise.all(
    ["Salle 1", "Salle 2", "Salle 3", "Salle 4", "Laboratoire"].map((name) =>
      prisma.room.create({ data: { schoolId, name, capacity: 45 } }),
    ),
  );

  const subjectDefs = [
    ["FR", "Français", "#2563EB"],
    ["MATH", "Mathématiques", "#DC2626"],
    ["PC", "Physique-Chimie", "#7C3AED"],
    ["SVT", "Biologie (SVT)", "#16A34A"],
    ["HG", "Histoire-Géographie", "#CA8A04"],
    ["ANG", "Anglais", "#0891B2"],
    ["ECM", "Éducation civique et morale", "#9333EA"],
    ["EPS", "Éducation physique", "#EA580C"],
  ] as const;
  const subjects = Object.fromEntries(
    await Promise.all(
      subjectDefs.map(
        async ([code, name, color]) =>
          [code, await prisma.subject.create({ data: { schoolId, code, name, color } })] as const,
      ),
    ),
  );

  const coefs: Record<string, Record<string, number>> = {
    [lv5.id]: { FR: 3, MATH: 3, HG: 1, SVT: 1, ECM: 1, EPS: 1 },
    [lv7.id]: { FR: 3, MATH: 3, PC: 2, SVT: 2, HG: 2, ANG: 2, ECM: 1, EPS: 1 },
    [lv9.id]: { FR: 3, MATH: 3, PC: 2, SVT: 2, HG: 2, ANG: 2, ECM: 1, EPS: 1 },
    [lv11.id]: { FR: 2, MATH: 5, PC: 4, SVT: 2, HG: 1, ANG: 2, EPS: 1 },
  };
  for (const [levelId, map] of Object.entries(coefs)) {
    for (const [code, coefficient] of Object.entries(map)) {
      await prisma.subjectCoefficient.create({
        data: {
          schoolId,
          levelId,
          subjectId: subjects[code].id,
          trackId: levelId === lv11.id ? tse.id : null,
          coefficient,
          weeklyMinutes: coefficient * 60,
        },
      });
    }
  }

  // Personnel
  const director = await createStaffMember(ctx, {
    firstName: "Ousmane",
    lastName: "Diarra",
    gender: "MALE",
    position: "Directeur",
    email: "directeur@les-etoiles.lakol.test",
    phone: "+22370000010",
    roles: ["DIRECTOR"],
    salary: 450000,
  });
  await createStaffMember(ctx, {
    firstName: "Fanta",
    lastName: "Camara",
    gender: "FEMALE",
    position: "Secrétaire",
    email: "secretariat@les-etoiles.lakol.test",
    roles: ["ADMIN"],
    salary: 150000,
  });
  await createStaffMember(ctx, {
    firstName: "Sékou",
    lastName: "Bagayoko",
    gender: "MALE",
    position: "Censeur",
    email: "censeur@les-etoiles.lakol.test",
    roles: ["CENSOR"],
    salary: 250000,
  });
  const cashier = await createStaffMember(ctx, {
    firstName: "Mariam",
    lastName: "Kouyaté",
    gender: "FEMALE",
    position: "Comptable",
    email: "comptable@les-etoiles.lakol.test",
    roles: ["ACCOUNTANT"],
    salary: 200000,
  });

  const teacherDefs = [
    {
      firstName: "Abdoulaye",
      lastName: "Sissoko",
      gender: "MALE",
      subjects: ["MATH"],
      email: "prof.maths@les-etoiles.lakol.test",
      phone: "+22370000020",
    },
    {
      firstName: "Kadiatou",
      lastName: "Dicko",
      gender: "FEMALE",
      subjects: ["FR", "ECM"],
      email: "prof.francais@les-etoiles.lakol.test",
      phone: "+22370000021",
    },
    { firstName: "Issa", lastName: "Kéita", gender: "MALE", subjects: ["PC", "SVT"] },
    { firstName: "Aïssata", lastName: "Fofana", gender: "FEMALE", subjects: ["HG"] },
    { firstName: "John", lastName: "Mensah", gender: "MALE", subjects: ["ANG"], hourly: 3500 },
    { firstName: "Hamidou", lastName: "Tangara", gender: "MALE", subjects: ["EPS"], hourly: 2500 },
  ] as const;
  const teachers: {
    staff: Awaited<ReturnType<typeof createStaffMember>>["staff"];
    user: Awaited<ReturnType<typeof createStaffMember>>["user"];
    subjects: readonly string[];
  }[] = [];
  for (const t of teacherDefs) {
    const { staff, user } = await createStaffMember(ctx, {
      firstName: t.firstName,
      lastName: t.lastName,
      gender: t.gender,
      position: "Professeur",
      email: "email" in t ? t.email : undefined,
      phone: "phone" in t ? t.phone : undefined,
      roles: ["TEACHER"],
      salary: "hourly" in t ? undefined : 220000,
      hourly: "hourly" in t ? t.hourly : undefined,
    });
    teachers.push({ staff, user, subjects: t.subjects as readonly string[] });
  }
  const teacherFor = (code: string) => teachers.find((t) => t.subjects.includes(code))!;

  // Classes (professeur principal = rôle HEAD_TEACHER en plus)
  const classDefs = [
    { name: "5e A", level: lv5, head: teacherFor("FR"), room: rooms[0], size: 7 },
    { name: "7e A", level: lv7, head: teacherFor("MATH"), room: rooms[1], size: 7 },
    { name: "9e A", level: lv9, head: teacherFor("PC"), room: rooms[2], size: 7 },
    { name: "11e TSE", level: lv11, head: teacherFor("HG"), room: rooms[3], size: 7, track: tse },
  ];
  const classes: ((typeof classDefs)[number] & { cls: Class; codes: string[] })[] = [];
  for (const def of classDefs) {
    const cls = await prisma.class.create({
      data: {
        schoolId,
        academicYearId: year.id,
        levelId: def.level.id,
        trackId: def.track?.id,
        roomId: def.room.id,
        headTeacherId: def.head.staff.id,
        name: def.name,
        capacity: 45,
      },
    });
    await grant(ctx, def.head.user.id, "HEAD_TEACHER");
    const levelCoefs = coefs[def.level.id];
    for (const code of Object.keys(levelCoefs)) {
      await prisma.teachingAssignment.create({
        data: {
          schoolId,
          staffId: teacherFor(code).staff.id,
          classId: cls.id,
          subjectId: subjects[code].id,
          academicYearId: year.id,
        },
      });
    }
    classes.push({ ...def, cls, codes: Object.keys(levelCoefs) });
  }

  // Emploi du temps de toutes les classes (lundi-vendredi, 4 créneaux le matin) :
  // pour chaque créneau, première matière dont le professeur est libre.
  const slots = [
    [480, 535],
    [540, 595],
    [610, 665],
    [670, 725],
  ];
  for (let day = 1; day <= 5; day++) {
    for (const [i, [startMin, endMin]] of slots.entries()) {
      const busy = new Set<string>();
      for (const [classIdx, c] of classes.entries()) {
        for (let k = 0; k < c.codes.length; k++) {
          const code = c.codes[(day * 4 + i + classIdx + k) % c.codes.length];
          const staffId = teacherFor(code).staff.id;
          if (busy.has(staffId)) continue;
          busy.add(staffId);
          await prisma.timetableSlot.create({
            data: {
              schoolId,
              classId: c.cls.id,
              subjectId: subjects[code].id,
              staffId,
              roomId: c.room.id,
              dayOfWeek: day,
              startMin,
              endMin,
            },
          });
          break;
        }
      }
    }
  }

  // Élèves et parents
  const birthYears: Record<string, number> = { "5e A": 2015, "7e A": 2013, "9e A": 2011, "11e TSE": 2009 };
  const students: { id: string; classIdx: number; lastName: string }[] = [];
  for (const [classIdx, def] of classes.entries()) {
    for (let i = 0; i < def.size; i++) {
      const gender: Gender = rand() < 0.5 ? "MALE" : "FEMALE";
      const lastName = pick(LAST);
      const s = await createStudent(ctx, {
        firstName: pick(gender === "MALE" ? MALE : FEMALE),
        lastName,
        gender,
        birthYear: birthYears[def.name],
        classId: def.cls.id,
        yearId: year.id,
        withAccount: def.level.studentAccounts,
      });
      students.push({ id: s.id, classIdx, lastName });
    }
  }

  // Parent de démonstration : deux enfants (7e A et 9e A).
  const demoParent = await createGuardian(ctx, {
    firstName: "Boubacar",
    lastName: "Traoré",
    phone: "+22370000001",
    email: "parent@lakol.test",
  });
  const kid1 = await createStudent(ctx, {
    firstName: "Aminata",
    lastName: "Traoré",
    gender: "FEMALE",
    birthYear: 2013,
    classId: classes[1].cls.id,
    yearId: year.id,
    withAccount: true,
  });
  const kid2 = await createStudent(ctx, {
    firstName: "Moussa",
    lastName: "Traoré",
    gender: "MALE",
    birthYear: 2011,
    classId: classes[2].cls.id,
    yearId: year.id,
    withAccount: true,
  });
  await link(ctx, kid1.id, demoParent.id, "FATHER");
  await link(ctx, kid2.id, demoParent.id, "FATHER");
  const mother = await createGuardian(ctx, { firstName: "Hawa", lastName: "Traoré", phone: "+22370000002" });
  await link(ctx, kid1.id, mother.id, "MOTHER", false);
  await link(ctx, kid2.id, mother.id, "MOTHER", false);
  students.push({ id: kid1.id, classIdx: 1, lastName: "Traoré" }, { id: kid2.id, classIdx: 2, lastName: "Traoré" });

  // Le professeur de français est aussi parent d'un élève de 5e A (multi-rôles).
  const profFr = teacherFor("FR");
  const profAsParent = await createGuardian(ctx, {
    firstName: profFr.user.firstName,
    lastName: profFr.user.lastName,
    phone: profFr.user.phone!,
    existingUserId: profFr.user.id,
  });
  await link(ctx, students[0].id, profAsParent.id, "MOTHER");

  // Les autres élèves : un parent chacun (téléphone fictif)
  for (const s of students.slice(1, -2)) {
    const g = await createGuardian(ctx, { firstName: pick(MALE), lastName: s.lastName, phone: nextPhone() });
    await link(ctx, s.id, g.id, "FATHER");
  }

  // Cahier de textes et devoirs
  const now = new Date();
  for (const c of classes) {
    for (const code of c.codes.slice(0, 4)) {
      const teacher = teacherFor(code);
      const lesson = await prisma.lesson.create({
        data: {
          schoolId,
          classId: c.cls.id,
          subjectId: subjects[code].id,
          staffId: teacher.staff.id,
          date: lastSchoolDays(2)[1],
          title: `${subjects[code].name} : séance du jour`,
          content: "Rappel du cours précédent, nouvelle notion, exercices d'application.",
        },
      });
      const hw = await prisma.homework.create({
        data: {
          schoolId,
          lessonId: lesson.id,
          classId: c.cls.id,
          subjectId: subjects[code].id,
          staffId: teacher.staff.id,
          title: code === "MATH" ? "Exercices 3 à 7 page 42" : `Révision : ${subjects[code].name}`,
          instructions: "Faire les exercices sur le cahier. Soigner la présentation.",
          dueAt: addDays(now, between(1, 6)),
          allowSubmission: code === "MATH",
          publishedAt: addDays(now, -1),
        },
      });
      for (const s of students.filter((x) => x.classIdx === classes.indexOf(c))) {
        if (rand() < 0.3) {
          await prisma.homeworkSubmission.create({
            data: { schoolId, homeworkId: hw.id, studentId: s.id, status: "DONE" },
          });
        }
      }
    }
  }

  // Présences des 5 derniers jours ouvrés
  const days = lastSchoolDays(5);
  for (const s of students) {
    const classId = classes[s.classIdx].cls.id;
    for (const day of days) {
      const r = rand();
      const status = r < 0.06 ? "ABSENT" : r < 0.1 ? "LATE" : "PRESENT";
      await prisma.attendance.create({
        data: {
          schoolId,
          studentId: s.id,
          classId,
          date: day,
          status,
          minutesLate: status === "LATE" ? between(5, 30) : null,
          recordedById: classes[s.classIdx].head.user.id,
        },
      });
    }
  }
  // Une absence connue pour le parcours de démonstration
  await prisma.attendance.updateMany({ where: { studentId: kid1.id, date: days[0] }, data: { status: "ABSENT" } });

  // Évaluations et notes : 1er trimestre validé, 2e trimestre en cours
  for (const c of classes) {
    for (const code of c.codes) {
      const teacher = teacherFor(code);
      for (const [termIdx, type, title, date] of [
        [0, "QUIZ", "Interrogation 1", "2025-10-24"],
        [0, "COMPOSITION", "Composition du 1er trimestre", "2025-12-12"],
        [1, "HOMEWORK", "Devoir 1", "2026-01-30"],
      ] as const) {
        const term = terms[termIdx];
        const locked = termIdx === 0;
        const assessment = await prisma.assessment.create({
          data: {
            schoolId,
            classId: c.cls.id,
            subjectId: subjects[code].id,
            termId: term.id,
            staffId: teacher.staff.id,
            type,
            title,
            date: d(date),
            outOf: 20,
            weight: type === "COMPOSITION" ? 2 : 1,
            isLocked: locked,
            validatedAt: locked ? d("2025-12-19") : null,
            validatedById: locked ? director.user.id : null,
          },
        });
        for (const s of students.filter((x) => x.classIdx === classes.indexOf(c))) {
          const absent = rand() < 0.03;
          await prisma.grade.create({
            data: {
              schoolId,
              assessmentId: assessment.id,
              studentId: s.id,
              isAbsent: absent,
              score: absent ? null : between(500, 1900) - between(0, 3) * 25,
            },
          });
        }
      }
    }
  }
  await prisma.term.update({ where: { id: terms[0].id }, data: { isLocked: true } });

  // Finances : inscription + scolarité trimestrielle
  const feeInscription = await prisma.feeType.create({
    data: { schoolId, name: "Frais d'inscription", category: "REGISTRATION" },
  });
  const feeTuition = await prisma.feeType.create({ data: { schoolId, name: "Scolarité", category: "TUITION" } });
  await prisma.feeType.create({ data: { schoolId, name: "Cantine", category: "CANTEEN", isOptional: true } });
  const tuitionByLevel: Record<string, number> = {
    [lv5.id]: 35000,
    [lv7.id]: 45000,
    [lv9.id]: 50000,
    [lv11.id]: 65000,
  };
  const inscriptionSchedule = await prisma.feeSchedule.create({
    data: {
      schoolId,
      feeTypeId: feeInscription.id,
      academicYearId: year.id,
      amount: 25000,
      frequency: "ONCE",
      installments: [{ label: "Inscription", dueDate: "2025-10-01" }],
    },
  });
  const tuitionSchedules: Record<string, string> = {};
  for (const [levelId, amount] of Object.entries(tuitionByLevel)) {
    tuitionSchedules[levelId] = (
      await prisma.feeSchedule.create({
        data: {
          schoolId,
          feeTypeId: feeTuition.id,
          academicYearId: year.id,
          levelId,
          amount,
          frequency: "TERMLY",
          installments: [
            { label: "1er trimestre", dueDate: "2025-10-15" },
            { label: "2e trimestre", dueDate: "2026-01-15" },
            { label: "3e trimestre", dueDate: "2026-04-15" },
          ],
        },
      })
    ).id;
  }
  // Réduction fratrie pour le 2e enfant du parent de démonstration
  const sibling = await prisma.discount.create({
    data: {
      schoolId,
      academicYearId: year.id,
      studentId: kid2.id,
      feeTypeId: feeTuition.id,
      kind: "SIBLING",
      label: "Réduction fratrie (10 %)",
      percentBp: 1000,
    },
  });

  let invoiceSeq = 0;
  let receiptSeq = 0;
  for (const s of students) {
    const level = classes[s.classIdx].level;
    const tuition = tuitionByLevel[level.id];
    const discount = s.id === kid2.id ? Math.round((tuition * 1000) / 10000) : 0;
    const invoiceDefs = [
      {
        label: "Inscription 2025-2026",
        due: "2025-10-01",
        sourceKey: `${inscriptionSchedule.id}:0`,
        lines: [{ label: "Frais d'inscription", amount: 25000, feeTypeId: feeInscription.id }],
      },
      ...["1er trimestre", "2e trimestre", "3e trimestre"].map((t, i) => ({
        label: `Scolarité — ${t}`,
        due: ["2025-10-15", "2026-01-15", "2026-04-15"][i],
        sourceKey: `${tuitionSchedules[level.id]}:${i}`,
        lines: [
          { label: `Scolarité ${t}`, amount: tuition, feeTypeId: feeTuition.id },
          ...(discount ? [{ label: sibling.label, amount: -discount, discountId: sibling.id }] : []),
        ],
      })),
    ];
    const paidUpTo = s.id === kid1.id ? 2 : s.id === kid2.id ? 1 : between(0, 3); // nombre de factures réglées
    for (const [i, inv] of invoiceDefs.entries()) {
      const total = inv.lines.reduce((sum, l) => sum + l.amount, 0);
      invoiceSeq += 1;
      const partial = i === paidUpTo && rand() < 0.5 ? Math.round(total / 2 / 500) * 500 : 0;
      const amountPaid = i < paidUpTo ? total : partial;
      const invoice = await prisma.invoice.create({
        data: {
          schoolId,
          studentId: s.id,
          academicYearId: year.id,
          number: `FAC-2025-${String(invoiceSeq).padStart(5, "0")}`,
          label: inv.label,
          sourceKey: inv.sourceKey,
          issueDate: d("2025-09-25"),
          dueDate: d(inv.due),
          total,
          amountPaid,
          status: amountPaid === 0 ? "UNPAID" : amountPaid < total ? "PARTIAL" : "PAID",
          lines: { create: inv.lines.map((l) => ({ ...l, schoolId })) },
        },
      });
      if (amountPaid > 0) {
        receiptSeq += 1;
        const method = pick(["CASH", "CASH", "CASH", "CHEQUE", "TRANSFER"] as const);
        await prisma.payment.create({
          data: {
            schoolId,
            studentId: s.id,
            amount: amountPaid,
            method,
            reference: method === "CASH" ? null : `REF-${between(100000, 999999)}`,
            paidAt: addDays(d(inv.due), -between(0, 10)),
            receivedById: cashier.user.id,
            allocations: { create: [{ schoolId, invoiceId: invoice.id, amount: amountPaid }] },
            receipt: { create: { schoolId, number: `REC-2025-${String(receiptSeq).padStart(5, "0")}` } },
          },
        });
      }
    }
  }
  await prisma.counter.createMany({
    data: [
      { schoolId, key: "invoice:2025", value: invoiceSeq },
      { schoolId, key: "receipt:2025", value: receiptSeq },
    ],
  });

  await prisma.expense.createMany({
    data: [
      {
        schoolId,
        category: "Fournitures",
        label: "Craies et marqueurs",
        amount: 35000,
        method: "CASH",
        spentAt: d("2025-10-03"),
        recordedById: cashier.user.id,
      },
      {
        schoolId,
        category: "Électricité",
        label: "Facture EDM octobre",
        amount: 87500,
        method: "TRANSFER",
        reference: "EDM-1025",
        spentAt: d("2025-10-28"),
        recordedById: cashier.user.id,
      },
    ],
  });

  // Communication : circulaire reçue par tous les parents (avec notification), une lecture confirmée.
  const parentUsers = await prisma.guardian.findMany({
    where: { schoolId, userId: { not: null }, deletedAt: null },
    select: { userId: true },
  });
  const announcement = await prisma.announcement.create({
    data: {
      schoolId,
      authorId: director.user.id,
      title: "Réunion parents-professeurs",
      audience: "PARENTS",
      targetIds: [],
      requiresAck: true,
      channels: ["IN_APP", "WHATSAPP"],
      body: "Une réunion parents-professeurs aura lieu samedi à 9h dans la cour de l'école. Votre présence est importante.",
      publishedAt: addDays(now, -2),
      recipientCount: parentUsers.length,
    },
  });
  await prisma.notification.createMany({
    data: parentUsers.map((g) => ({
      schoolId,
      userId: g.userId!,
      type: "announcement",
      title: announcement.title,
      body: announcement.body,
      link: `/les-etoiles/announcements/${announcement.id}`,
      refType: "Announcement",
      refId: announcement.id,
      createdAt: announcement.publishedAt!,
    })),
  });
  // Créneaux de rendez-vous du professeur de maths la semaine prochaine (16 h – 17 h).
  const meetingDay = addDays(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), 7);
  await prisma.meetingSlot.createMany({
    data: Array.from({ length: 4 }, (_, i) => ({
      schoolId,
      staffId: teacherFor("MATH").staff.id,
      startsAt: new Date(meetingDay.getTime() + (16 * 60 + i * 15) * 60_000),
      endsAt: new Date(meetingDay.getTime() + (16 * 60 + (i + 1) * 15) * 60_000),
      location: "Salle 7e A",
    })),
  });
  const conversation = await prisma.conversation.create({
    data: { schoolId, subject: "Devoir de mathématiques", studentId: kid1.id },
  });
  const parentUserId = demoParent.userId!;
  const mathTeacher = teacherFor("MATH").user;
  await prisma.conversationParticipant.createMany({
    data: [
      { schoolId, conversationId: conversation.id, userId: parentUserId },
      { schoolId, conversationId: conversation.id, userId: mathTeacher.id, lastReadAt: now },
    ],
  });
  await prisma.message.createMany({
    data: [
      {
        schoolId,
        conversationId: conversation.id,
        senderId: parentUserId,
        body: "Bonjour Monsieur, Aminata n'a pas compris l'exercice 5. Pouvez-vous l'aider demain ?",
        createdAt: addDays(now, -1),
      },
      {
        schoolId,
        conversationId: conversation.id,
        senderId: mathTeacher.id,
        body: "Bonjour, bien sûr. Je reprendrai l'exercice en classe demain matin.",
        createdAt: now,
      },
    ],
  });
  await prisma.notification.create({
    data: {
      schoolId,
      userId: parentUserId,
      type: "attendance.absent",
      title: "Absence",
      body: `Aminata Traoré a été marquée absente le ${days[0].toLocaleDateString("fr-FR")}.`,
      link: "/les-etoiles/attendance",
    },
  });

  // Modules optionnels (formule Premium) : cantine, transport, bibliothèque, infirmerie, stocks, ressources.
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const meals = ["Riz sauce arachide", "Tô sauce gombo", "Fonio au poulet", "Macaronis à la viande", "Riz gras"];
  await prisma.canteenMenu.createMany({
    data: meals.map((meal, i) => ({
      schoolId,
      date: addDays(monday, i),
      meal,
      notes: i === 4 ? "Fruit : mangue" : null,
    })),
  });
  await prisma.canteenSubscription.createMany({
    data: [kid1.id, kid2.id, ...students.slice(0, 8).map((s) => s.id)].map((studentId, i) => ({
      schoolId,
      studentId,
      academicYearId: year.id,
      startDate: year.startDate,
      dietNotes: i === 0 ? "Allergie à l'arachide" : null,
    })),
  });
  const driver = await createStaffMember(ctx, {
    firstName: "Adama",
    lastName: "Koné",
    gender: "MALE",
    position: "Chauffeur",
    phone: "+22370000030",
    roles: ["DRIVER"],
    salary: 90000,
  });
  const route = await prisma.busRoute.create({
    data: {
      schoolId,
      name: "Circuit Kalaban",
      vehicle: "Minibus AB-1234-MD",
      capacity: 18,
      driverStaffId: driver.staff.id,
    },
  });
  const busStops: { id: string }[] = [];
  for (const [i, [name, pickup, dropoff]] of (
    [
      ["Kalaban Coura — marché", 410, 1050],
      ["Baco-Djicoroni ACI", 425, 1035],
      ["Hamdallaye — station", 440, 1020],
    ] as const
  ).entries()) {
    busStops.push(
      await prisma.busStop.create({
        data: { schoolId, routeId: route.id, name, order: i + 1, pickupMin: pickup, dropoffMin: dropoff },
      }),
    );
  }
  await prisma.transportAssignment.createMany({
    data: [kid1.id, kid2.id, ...students.slice(10, 14).map((s) => s.id)].map((studentId, i) => ({
      schoolId,
      studentId,
      academicYearId: year.id,
      routeId: route.id,
      stopId: busStops[i % busStops.length].id,
    })),
  });
  const books = await Promise.all(
    [
      ["L'Aventure ambiguë", "Cheikh Hamidou Kane", "Roman", 3],
      ["Une si longue lettre", "Mariama Bâ", "Roman", 2],
      ["Soundjata ou l'épopée mandingue", "Djibril Tamsir Niane", "Épopée", 4],
      ["Mathématiques 7e année", "IPN Mali", "Manuel", 10],
      ["Le Pagne noir", "Bernard Dadié", "Contes", 2],
    ].map(([title, author, category, copies]) =>
      prisma.book.create({
        data: {
          schoolId,
          title: String(title),
          author: String(author),
          category: String(category),
          copies: Number(copies),
          location: "Rayon A",
        },
      }),
    ),
  );
  await prisma.bookLoan.createMany({
    data: [
      { schoolId, bookId: books[2].id, studentId: kid2.id, loanedAt: addDays(now, -5), dueAt: addDays(now, 9) },
      {
        schoolId,
        bookId: books[0].id,
        studentId: students[3].id,
        loanedAt: addDays(now, -20),
        dueAt: addDays(now, -6),
      },
    ],
  });
  await prisma.infirmaryVisit.create({
    data: {
      schoolId,
      studentId: students[5].id,
      at: addDays(now, -2),
      reason: "Maux de tête",
      care: "Repos, eau",
      outcome: "RETURNED_TO_CLASS",
      recordedById: director.user.id,
    },
  });
  for (const [name, category, unit, quantity, minQuantity] of [
    ["Craies blanches", "Fournitures", "boîte", 4, 10],
    ["Rames de papier A4", "Fournitures", "rame", 25, 5],
    ["Ballons de football", "Sport", "unité", 6, 2],
    ["Riz (sac de 50 kg)", "Cantine", "sac", 8, 3],
  ] as const) {
    await prisma.inventoryItem.create({ data: { schoolId, name, category, unit, quantity, minQuantity } });
  }
  await prisma.resource.createMany({
    data: [
      {
        schoolId,
        subjectId: subjects.MATH.id,
        levelId: lv7.id,
        type: "COURSE",
        title: "Les fractions — cours complet",
        description: "Cours et exemples corrigés, chapitre 3.",
        url: "https://fr.khanacademy.org/math/arithmetic/fraction-arithmetic",
        createdById: teacherFor("MATH").user.id,
      },
      {
        schoolId,
        subjectId: subjects.FR.id,
        levelId: lv9.id,
        type: "PAST_EXAM",
        title: "Sujet DEF 2024 — Français",
        description: "Sujet de l'examen du DEF, session de juin 2024.",
        url: "https://www.education.gouv.ml",
        createdById: director.user.id,
      },
    ],
  });

  await prisma.event.createMany({
    data: [
      {
        schoolId,
        type: "HOLIDAY",
        title: "Fête de l'indépendance",
        startsAt: d("2025-09-22"),
        endsAt: d("2025-09-22"),
      },
      { schoolId, type: "VACATION", title: "Vacances de Noël", startsAt: d("2025-12-22"), endsAt: d("2026-01-04") },
      { schoolId, type: "EXAM", title: "Examen blanc DEF", startsAt: d("2026-04-20"), endsAt: d("2026-04-24") },
    ],
  });

  await prisma.auditLog.create({
    data: {
      schoolId,
      actorId: director.user.id,
      action: "grade.validate_term",
      entityType: "Term",
      entityId: terms[0].id,
      after: { isLocked: true },
    },
  });

  return { students: students.length };
}

// ── Seconde école (isolation multi-tenant) ────────────────────────────────

async function seedSavoir(planId: string) {
  const ctx = await createSchool(
    {
      slug: "le-savoir",
      name: "École Le Savoir",
      shortName: "Le Savoir",
      city: "Sikasso",
      address: "Quartier Wayerma, Sikasso",
      primaryColor: "#1D4ED8",
    },
    planId,
    "SAV",
  );
  const { schoolId } = ctx;
  const { year } = await createYear(ctx);
  const cycle = await prisma.cycle.create({ data: { schoolId, name: "Fondamental 2e cycle", order: 1 } });
  const level = await prisma.level.create({ data: { schoolId, cycleId: cycle.id, name: "8e année", order: 8 } });
  const math = await prisma.subject.create({ data: { schoolId, code: "MATH", name: "Mathématiques" } });
  await createStaffMember(ctx, {
    firstName: "Salif",
    lastName: "Koné",
    gender: "MALE",
    position: "Directeur",
    email: "directeur@le-savoir.lakol.test",
    roles: ["DIRECTOR"],
  });
  const { staff } = await createStaffMember(ctx, {
    firstName: "Nènè",
    lastName: "Sow",
    gender: "FEMALE",
    position: "Professeur",
    email: "prof@le-savoir.lakol.test",
    roles: ["TEACHER"],
  });
  const cls = await prisma.class.create({
    data: { schoolId, academicYearId: year.id, levelId: level.id, name: "8e A", headTeacherId: staff.id },
  });
  await prisma.teachingAssignment.create({
    data: { schoolId, staffId: staff.id, classId: cls.id, subjectId: math.id, academicYearId: year.id },
  });
  for (let i = 0; i < 3; i++) {
    const gender: Gender = i % 2 ? "FEMALE" : "MALE";
    const s = await createStudent(ctx, {
      firstName: pick(gender === "MALE" ? MALE : FEMALE),
      lastName: pick(LAST),
      gender,
      birthYear: 2012,
      classId: cls.id,
      yearId: year.id,
      withAccount: false,
    });
    const g = await createGuardian(ctx, { firstName: pick(MALE), lastName: "Koné", phone: nextPhone() });
    await link(ctx, s.id, g.id, "FATHER");
  }
}

async function main() {
  console.time("seed");
  await resetDatabase();
  const plans = await seedPlatform();
  const etoiles = await seedEtoiles(plans.PREMIUM.id);
  await seedSavoir(plans.STANDARD.id);
  console.timeEnd("seed");
  console.log(`École « Les Étoiles » : ${etoiles.students} élèves. Comptes : voir README.md.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
