import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";

const permissions = [
  // Absensi
  ["attendance.view.today", "Melihat dashboard absensi hari ini"],
  ["attendance.view.detail", "Melihat detail absensi"],
  ["attendance.input.today", "Input absensi hari ini"],
  ["attendance.edit.own", "Edit absensi sendiri"],
  ["attendance.edit.all", "Edit semua absensi"],
  ["attendance.report.view", "Melihat rekap absensi"],
  ["attendance.report.export", "Export rekap absensi"],
  ["attendance.ranking.view", "Melihat ranking absensi"],

  // Siswa
  ["student.view", "Melihat data siswa"],
  ["student.create", "Menambah data siswa"],
  ["student.update", "Mengubah data siswa"],
  ["student.delete", "Menghapus data siswa"],
  ["student.import", "Import data siswa"],
  ["student.export", "Export data siswa"],

  // Kelas
  ["class.view", "Melihat data kelas"],
  ["class.create", "Menambah data kelas"],
  ["class.update", "Mengubah data kelas"],
  ["class.delete", "Menghapus data kelas"],

  // User dan role
  ["user.view", "Melihat user"],
  ["user.create", "Menambah user"],
  ["user.update", "Mengubah user"],
  ["user.delete", "Menghapus user"],
  ["role.view", "Melihat role"],
  ["role.manage", "Mengelola role"],
  ["permission.manage", "Mengelola permission"],

  // Sistem
  ["setting.view", "Melihat pengaturan"],
  ["setting.manage", "Mengelola pengaturan"],
  ["audit.view", "Melihat audit log"],
  ["backup.manage", "Mengelola backup"],
] as const;

const roles = [
  ["super_admin", "Super Admin", "Akses penuh sistem"],
  ["admin", "Admin", "Mengelola data master dan absensi"],
  ["guru", "Guru", "Input absensi dan melihat dashboard"],
  ["wali_kelas", "Wali Kelas", "Melihat rekap kelas binaan"],
  ["guest_internal", "Guest Internal", "Akses lihat cepat untuk guru"],
] as const;

const attendanceStatuses = [
  {
    code: "H",
    name: "Hadir",
    description: "Siswa hadir",
    isPresent: true,
    isAbsent: false,
    sortOrder: 1,
  },
  {
    code: "S",
    name: "Sakit",
    description: "Siswa tidak hadir karena sakit",
    isPresent: false,
    isAbsent: true,
    sortOrder: 2,
  },
  {
    code: "I",
    name: "Izin",
    description: "Siswa tidak hadir karena izin",
    isPresent: false,
    isAbsent: true,
    sortOrder: 3,
  },
  {
    code: "A",
    name: "Alfa",
    description: "Siswa tidak hadir tanpa keterangan",
    isPresent: false,
    isAbsent: true,
    sortOrder: 4,
  },
  {
    code: "T",
    name: "Terlambat",
    description: "Siswa datang terlambat",
    isPresent: false,
    isAbsent: false,
    sortOrder: 5,
  },
  {
    code: "D",
    name: "Dispensasi",
    description: "Siswa dispensasi kegiatan tertentu",
    isPresent: false,
    isAbsent: false,
    sortOrder: 6,
  },
];

async function main() {
  console.log("Mulai seed SISMEPDA...");

  await prisma.appSetting.upsert({
    where: { key: "app_name" },
    update: { value: "SISMEPDA" },
    create: {
      key: "app_name",
      value: "SISMEPDA",
      description: "Nama pendek aplikasi",
    },
  });

  await prisma.appSetting.upsert({
    where: { key: "app_full_name" },
    update: { value: "Sistem Informasi SMPN 2 Blitar" },
    create: {
      key: "app_full_name",
      value: "Sistem Informasi SMPN 2 Blitar",
      description: "Nama lengkap aplikasi",
    },
  });

  await prisma.appSetting.upsert({
    where: { key: "school_name" },
    update: { value: "SMPN 2 Blitar" },
    create: {
      key: "school_name",
      value: "SMPN 2 Blitar",
      description: "Nama sekolah",
    },
  });

  for (const status of attendanceStatuses) {
    await prisma.attendanceStatus.upsert({
      where: { code: status.code },
      update: status,
      create: status,
    });
  }

  const roleMap = new Map<string, string>();

  for (const [code, name, description] of roles) {
    const role = await prisma.role.upsert({
      where: { code },
      update: { name, description },
      create: { code, name, description },
    });

    roleMap.set(code, role.id);
  }

  const permissionMap = new Map<string, string>();

  for (const [code, name] of permissions) {
    const permission = await prisma.permission.upsert({
      where: { code },
      update: { name },
      create: {
        code,
        name,
        description: name,
      },
    });

    permissionMap.set(code, permission.id);
  }

  async function grantPermissions(roleCode: string, permissionCodes: string[]) {
    const roleId = roleMap.get(roleCode);

    if (!roleId) {
      throw new Error(`Role ${roleCode} tidak ditemukan.`);
    }

    const data = permissionCodes.map((permissionCode) => {
      const permissionId = permissionMap.get(permissionCode);

      if (!permissionId) {
        throw new Error(`Permission ${permissionCode} tidak ditemukan.`);
      }

      return {
        roleId,
        permissionId,
      };
    });

    await prisma.rolePermission.createMany({
      data,
      skipDuplicates: true,
    });
  }

  await grantPermissions("super_admin", Array.from(permissionMap.keys()));

  await grantPermissions("admin", [
    "attendance.view.today",
    "attendance.view.detail",
    "attendance.input.today",
    "attendance.edit.own",
    "attendance.edit.all",
    "attendance.report.view",
    "attendance.report.export",
    "attendance.ranking.view",

    "student.view",
    "student.create",
    "student.update",
    "student.delete",
    "student.import",
    "student.export",

    "class.view",
    "class.create",
    "class.update",
    "class.delete",

    "setting.view",
  ]);

  await grantPermissions("guru", [
    "attendance.view.today",
    "attendance.input.today",
    "attendance.report.view",
  ]);

  await grantPermissions("wali_kelas", [
    "attendance.view.today",
    "attendance.view.detail",
    "attendance.input.today",
    "attendance.edit.own",
    "attendance.report.view",
    "attendance.report.export",
    "attendance.ranking.view",

    "student.view",
    "class.view",
  ]);

  await grantPermissions("guest_internal", [
    "attendance.view.today",
    "attendance.report.view",
    "attendance.ranking.view",
  ]);


  const superAdminRoleId = roleMap.get("super_admin");

  if (!superAdminRoleId) {
    throw new Error("Role super_admin tidak ditemukan.");
  }
  
  const adminPasswordHash = await bcrypt.hash("admin12345", 12);

  const superAdmin = await prisma.user.upsert({
    where: { username: "superadmin" },
    update: {
      name: "Super Admin",
      passwordHash: adminPasswordHash,
      status: "ACTIVE",
    },
    create: {
      username: "superadmin",
      name: "Super Admin",
      passwordHash: adminPasswordHash,
      status: "ACTIVE",
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: superAdmin.id,
        roleId: superAdminRoleId,
      },
    },
    update: {},
    create: {
      userId: superAdmin.id,
      roleId: superAdminRoleId,
    },
  });

  const guestRoleId = roleMap.get("guest_internal");

  if (!guestRoleId) {
    throw new Error("Role guest_internal tidak ditemukan.");
  }

  const guestPasswordHash = await bcrypt.hash("guest12345", 12);

  const guestUser = await prisma.user.upsert({
    where: { username: "guest" },
    update: {
      name: "Guest Internal",
      passwordHash: guestPasswordHash,
      status: "ACTIVE",
    },
    create: {
      username: "guest",
      name: "Guest Internal",
      passwordHash: guestPasswordHash,
      status: "ACTIVE",
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: guestUser.id,
        roleId: guestRoleId,
      },
    },
    update: {},
    create: {
      userId: guestUser.id,
      roleId: guestRoleId,
    },
  });

  await prisma.academicYear.upsert({
    where: { name: "2025/2026" },
    update: {
      isActive: true,
    },
    create: {
      name: "2025/2026",
      startDate: new Date("2025-07-01"),
      endDate: new Date("2026-06-30"),
      isActive: true,
    },
  });

  const activeAcademicYear = await prisma.academicYear.findUniqueOrThrow({
    where: { name: "2025/2026" },
  });

  await prisma.semester.upsert({
    where: {
      academicYearId_name: {
        academicYearId: activeAcademicYear.id,
        name: "Ganjil",
      },
    },
    update: {
      isActive: true,
    },
    create: {
      academicYearId: activeAcademicYear.id,
      name: "Ganjil",
      startDate: new Date("2025-07-01"),
      endDate: new Date("2025-12-31"),
      isActive: true,
    },
  });

  const class7A = await prisma.schoolClass.upsert({
    where: {
      name_academicYearId: {
        name: "VII A",
        academicYearId: activeAcademicYear.id,
      },
    },
    update: {
      gradeLevel: 7,
    },
    create: {
      name: "VII A",
      gradeLevel: 7,
      academicYearId: activeAcademicYear.id,
    },
  });

  const class7B = await prisma.schoolClass.upsert({
    where: {
      name_academicYearId: {
        name: "VII B",
        academicYearId: activeAcademicYear.id,
      },
    },
    update: {
      gradeLevel: 7,
    },
    create: {
      name: "VII B",
      gradeLevel: 7,
      academicYearId: activeAcademicYear.id,
    },
  });

  const students = [
    {
      nis: "25001",
      nisn: "001",
      name: "Ahmad Fikri",
      gender: "MALE" as const,
      schoolClassId: class7A.id,
    },
    {
      nis: "25002",
      nisn: "002",
      name: "Budi Santoso",
      gender: "MALE" as const,
      schoolClassId: class7A.id,
    },
    {
      nis: "25003",
      nisn: "003",
      name: "Citra Ayu",
      gender: "FEMALE" as const,
      schoolClassId: class7A.id,
    },
    {
      nis: "25004",
      nisn: "004",
      name: "Dewi Lestari",
      gender: "FEMALE" as const,
      schoolClassId: class7B.id,
    },
    {
      nis: "25005",
      nisn: "005",
      name: "Eko Prasetyo",
      gender: "MALE" as const,
      schoolClassId: class7B.id,
    },
  ];

  for (const item of students) {
    const student = await prisma.student.upsert({
      where: {
        nis: item.nis,
      },
      update: {
        nisn: item.nisn,
        name: item.name,
        gender: item.gender,
        status: "ACTIVE",
      },
      create: {
        nis: item.nis,
        nisn: item.nisn,
        name: item.name,
        gender: item.gender,
        status: "ACTIVE",
      },
    });

    const existingEnrollment = await prisma.classEnrollment.findFirst({
      where: {
        studentId: student.id,
        academicYearId: activeAcademicYear.id,
        schoolClassId: item.schoolClassId,
      },
    });

    if (!existingEnrollment) {
      await prisma.classEnrollment.create({
        data: {
          studentId: student.id,
          schoolClassId: item.schoolClassId,
          academicYearId: activeAcademicYear.id,
          startDate: new Date("2025-07-01"),
          status: "ACTIVE",
        },
      });
    }
  }

  console.log("Seed selesai.");
  console.log("Super Admin: username=superadmin password=admin12345");
  console.log("Guest: username=guest password=guest12345");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });