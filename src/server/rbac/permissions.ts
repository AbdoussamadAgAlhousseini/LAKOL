// Catalogue des permissions. Une clé suffixée `:own` limite l'action au
// périmètre de l'utilisateur (classes du professeur, enfants du parent,
// élève lui-même). Voir policies.ts.

export const PERMISSIONS = {
  // École et structure
  "school.settings.manage": { module: "school", description: "Paramètres et personnalisation de l'école" },
  "school.structure.manage": { module: "school", description: "Années, périodes, classes, matières" },
  "user.manage": { module: "school", description: "Comptes utilisateurs" },
  "role.manage": { module: "school", description: "Rôles et permissions" },
  "audit.read": { module: "school", description: "Journal d'audit" },
  "dashboard.school": { module: "reports", description: "Tableau de bord de l'école" },

  // Élèves, tuteurs, personnel
  "student.read": { module: "students", description: "Voir tous les élèves" },
  "student.read:own": { module: "students", description: "Voir ses élèves / ses enfants / soi-même" },
  "student.write": { module: "students", description: "Inscrire et modifier les élèves" },
  "student.import": { module: "students", description: "Importer des élèves" },
  "student.medical.read": { module: "students", description: "Voir les informations médicales" },
  "guardian.read": { module: "students", description: "Voir les tuteurs" },
  "guardian.write": { module: "students", description: "Gérer les tuteurs" },
  "staff.read": { module: "staff", description: "Voir le personnel" },
  "staff.write": { module: "staff", description: "Gérer le personnel et les affectations" },

  // Pédagogie
  "timetable.read": { module: "timetable", description: "Voir les emplois du temps" },
  "timetable.write": { module: "timetable", description: "Construire les emplois du temps" },
  "lesson.write:own": { module: "homework", description: "Remplir le cahier de textes de ses classes" },
  "homework.read": { module: "homework", description: "Voir tous les devoirs" },
  "homework.read:own": { module: "homework", description: "Voir les devoirs de son périmètre" },
  "homework.write:own": { module: "homework", description: "Publier et corriger des devoirs dans ses classes" },
  "homework.submit:own": { module: "homework", description: "Rendre un devoir" },

  // Vie scolaire
  "attendance.read": { module: "attendance", description: "Voir toutes les présences" },
  "attendance.read:own": { module: "attendance", description: "Voir les présences de son périmètre" },
  "attendance.write": { module: "attendance", description: "Saisir les présences de toute classe" },
  "attendance.write:own": { module: "attendance", description: "Faire l'appel dans ses classes" },
  "attendance.justify:own": { module: "attendance", description: "Justifier une absence de son enfant" },
  "discipline.read": { module: "attendance", description: "Voir la discipline" },
  "discipline.write": { module: "attendance", description: "Gérer incidents et sanctions" },

  // Évaluations
  "grade.read": { module: "grades", description: "Voir toutes les notes" },
  "grade.read:own": { module: "grades", description: "Voir les notes de son périmètre" },
  "grade.write:own": { module: "grades", description: "Saisir les notes de ses classes" },
  "grade.validate": { module: "grades", description: "Valider et verrouiller les notes" },
  "grade.unlock": { module: "grades", description: "Modifier une note après validation (audité)" },
  "reportcard.comment:own": { module: "grades", description: "Appréciation générale (professeur principal)" },
  "reportcard.publish": { module: "grades", description: "Publier les bulletins" },
  "council.manage": { module: "grades", description: "Décisions du conseil de classe" },

  // Finances
  "finance.read": { module: "finance", description: "Voir les finances de l'école" },
  "finance.read:own": { module: "finance", description: "Voir les frais de ses enfants" },
  "fee.manage": { module: "finance", description: "Grilles de frais et réductions" },
  "payment.write": { module: "finance", description: "Enregistrer un paiement" },
  "payment.cancel": { module: "finance", description: "Annuler un paiement (audité)" },
  "expense.write": { module: "finance", description: "Dépenses et caisse" },
  "payroll.manage": { module: "finance", description: "Salaires et vacations" },

  // Communication
  "message.send": { module: "messaging", description: "Messagerie interne" },
  "message.moderate": { module: "messaging", description: "Modérer les messages signalés" },
  "meeting.manage:own": { module: "messaging", description: "Proposer des créneaux de rendez-vous" },
  "meeting.book:own": { module: "messaging", description: "Réserver un rendez-vous avec un professeur" },
  "announcement.publish": { module: "messaging", description: "Publier des annonces" },

  // Ressources et modules optionnels
  "resource.read": { module: "resources", description: "Consulter les ressources" },
  "resource.write": { module: "resources", description: "Publier des ressources" },
  "library.manage": { module: "library", description: "Bibliothèque" },
  "infirmary.manage": { module: "infirmary", description: "Infirmerie" },
  "transport.manage": { module: "transport", description: "Transport scolaire" },
} as const satisfies Record<string, { module: string; description: string }>;

export type Permission = keyof typeof PERMISSIONS;

export const SYSTEM_ROLES = [
  "DIRECTOR",
  "ADMIN",
  "CENSOR",
  "ACCOUNTANT",
  "TEACHER",
  "HEAD_TEACHER",
  "PARENT",
  "STUDENT",
  "LIBRARIAN",
  "NURSE",
  "DRIVER",
] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

const ALL = Object.keys(PERMISSIONS) as Permission[];
const SELF_ONLY = new Set<Permission>(["homework.submit:own", "attendance.justify:own", "meeting.book:own"]);

const TEACHER: Permission[] = [
  "student.read:own",
  "timetable.read",
  "lesson.write:own",
  "homework.read:own",
  "homework.write:own",
  "attendance.read:own",
  "attendance.write:own",
  "grade.read:own",
  "grade.write:own",
  "message.send",
  "resource.read",
  "resource.write",
  "meeting.manage:own",
];

export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRole, Permission[]> = {
  DIRECTOR: ALL.filter((p) => !SELF_ONLY.has(p)),
  ADMIN: [
    "school.structure.manage",
    "user.manage",
    "dashboard.school",
    "student.read",
    "student.write",
    "student.import",
    "student.medical.read",
    "guardian.read",
    "guardian.write",
    "staff.read",
    "staff.write",
    "timetable.read",
    "timetable.write",
    "homework.read",
    "attendance.read",
    "grade.read",
    "message.send",
    "message.moderate",
    "announcement.publish",
    "resource.read",
  ],
  CENSOR: [
    "dashboard.school",
    "student.read",
    "student.medical.read",
    "guardian.read",
    "timetable.read",
    "attendance.read",
    "attendance.write",
    "discipline.read",
    "discipline.write",
    "homework.read",
    "grade.read",
    "message.send",
    "announcement.publish",
  ],
  ACCOUNTANT: [
    "student.read",
    "guardian.read",
    "finance.read",
    "fee.manage",
    "payment.write",
    "expense.write",
    "payroll.manage",
    "message.send",
  ],
  TEACHER,
  HEAD_TEACHER: [...TEACHER, "reportcard.comment:own", "discipline.read"],
  PARENT: [
    "student.read:own",
    "timetable.read",
    "homework.read:own",
    "attendance.read:own",
    "attendance.justify:own",
    "grade.read:own",
    "finance.read:own",
    "message.send",
    "meeting.book:own",
  ],
  STUDENT: [
    "student.read:own",
    "timetable.read",
    "homework.read:own",
    "homework.submit:own",
    "attendance.read:own",
    "grade.read:own",
    "resource.read",
  ],
  LIBRARIAN: ["student.read", "library.manage", "resource.read"],
  NURSE: ["student.read", "student.medical.read", "infirmary.manage"],
  DRIVER: ["transport.manage"],
};

/** Ordre de préférence pour choisir l'espace par défaut. */
export const ROLE_PRIORITY: SystemRole[] = [
  "DIRECTOR",
  "ADMIN",
  "CENSOR",
  "ACCOUNTANT",
  "HEAD_TEACHER",
  "TEACHER",
  "LIBRARIAN",
  "NURSE",
  "DRIVER",
  "PARENT",
  "STUDENT",
];
