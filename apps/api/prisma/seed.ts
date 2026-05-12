import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/** Stable UUID so `NEXT_PUBLIC_DEFAULT_COMPANY_ID` can match after a fresh seed. Override with `SEED_COMPANY_ID`. */
const DEFAULT_SEED_COMPANY_ID = '00000000-0000-4000-8000-000000000001';

async function main() {
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'Change-me!23456';
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@demo.local').toLowerCase();
  const agentEmail = (process.env.SEED_AGENT_EMAIL ?? 'agent@demo.local').toLowerCase();
  const seedCompanyId = (process.env.SEED_COMPANY_ID ?? DEFAULT_SEED_COMPANY_ID).trim();

  const passwordHash = await bcrypt.hash(password, 10);

  let company = await prisma.company.findUnique({ where: { id: seedCompanyId } });
  if (!company) {
    const existingByName = await prisma.company.findFirst({
      where: { name: 'Demo Rent' },
    });
    if (existingByName) {
      company = existingByName;
      await prisma.company.update({
        where: { id: company.id },
        data: {
          oneWayFeeCents: 4500,
          cargosInScope: true,
          cargosAdapter: 'MOCK',
          cargosEnvironment: 'TEST',
          sdiAdapter: 'OFF',
        },
      });
    } else {
      company = await prisma.company.create({
        data: {
          id: seedCompanyId,
          name: 'Demo Rent',
          oneWayFeeCents: 4500,
          cargosInScope: true,
          cargosAdapter: 'MOCK',
          cargosEnvironment: 'TEST',
          sdiAdapter: 'OFF',
        },
      });
    }
  } else {
    await prisma.company.update({
      where: { id: company.id },
      data: {
        name: 'Demo Rent',
        oneWayFeeCents: 4500,
        cargosInScope: true,
        cargosAdapter: 'MOCK',
        cargosEnvironment: 'TEST',
        sdiAdapter: 'OFF',
      },
    });
  }

  const companyId = company.id;

  let stations = await prisma.station.findMany({
    where: { companyId },
    orderBy: { code: 'asc' },
  });

  if (stations.length === 0) {
    await prisma.station.createMany({
      data: [
        {
          companyId,
          name: 'Milan — Malpensa area',
          code: 'MIL',
          addressLine: 'Via Seed Demo 1',
          city: 'Ferno',
          province: 'VA',
          postalCode: '21010',
          country: 'IT',
          cargosLocationCode: 'IT-MIL-SEED',
        },
        {
          companyId,
          name: 'Rome — Fiumicino area',
          code: 'ROM',
          addressLine: 'Via Seed Demo 2',
          city: 'Fiumicino',
          province: 'RM',
          postalCode: '00054',
          country: 'IT',
          cargosLocationCode: 'IT-ROM-SEED',
        },
      ],
    });
    stations = await prisma.station.findMany({
      where: { companyId },
      orderBy: { code: 'asc' },
    });
  }

  const stationMilan = stations.find((s) => s.code === 'MIL') ?? stations[0];
  const stationRome = stations.find((s) => s.code === 'ROM') ?? stations[1] ?? stationMilan;

  let vehicleClass = await prisma.vehicleClass.findFirst({
    where: { companyId, code: 'ECON' },
  });
  if (!vehicleClass) {
    vehicleClass = await prisma.vehicleClass.create({
      data: {
        companyId,
        name: 'Economy',
        code: 'ECON',
        defaultDailyCents: 4990,
        defaultDepositCents: 30000,
      },
    });
  } else {
    vehicleClass = await prisma.vehicleClass.update({
      where: { id: vehicleClass.id },
      data: {
        name: 'Economy',
        defaultDailyCents: 4990,
        defaultDepositCents: 30000,
      },
    });
  }

  const compact = await prisma.vehicleClass.upsert({
    where: {
      companyId_code: { companyId, code: 'COMPACT' },
    },
    create: {
      companyId,
      name: 'Compact',
      code: 'COMPACT',
      defaultDailyCents: 5990,
      defaultDepositCents: 35000,
    },
    update: {
      name: 'Compact',
      defaultDailyCents: 5990,
      defaultDepositCents: 35000,
    },
  });

  const seedPlates = ['DM010AA', 'DM011AA', 'DM020BB'];
  for (const plate of seedPlates) {
    const exists = await prisma.vehicle.findFirst({
      where: { companyId, licensePlate: plate },
    });
    if (exists) {
      await prisma.vehicle.update({
        where: { id: exists.id },
        data: {
          status: 'AVAILABLE',
          vehicleClassId: plate.startsWith('DM020') ? compact.id : vehicleClass.id,
          homeStationId: plate.startsWith('DM020') ? stationRome.id : stationMilan.id,
          vehicleType: 'CAR',
          coverImageUrl:
            plate === 'DM010AA'
              ? 'https://picsum.photos/seed/demo-rent-car-a/640/400'
              : plate === 'DM011AA'
                ? 'https://picsum.photos/seed/demo-rent-car-b/640/400'
                : 'https://picsum.photos/seed/demo-rent-car-c/640/400',
        },
      });
      continue;
    }
    await prisma.vehicle.create({
      data: {
        companyId,
        licensePlate: plate,
        vehicleType: 'CAR',
        status: 'AVAILABLE',
        vehicleClassId: plate.startsWith('DM020') ? compact.id : vehicleClass.id,
        homeStationId: plate.startsWith('DM020') ? stationRome.id : stationMilan.id,
        vin: plate === 'DM010AA' ? 'SEEDVIN00000000001' : plate === 'DM011AA' ? 'SEEDVIN00000000002' : 'SEEDVIN00000000003',
        modelLabel: plate.startsWith('DM020') ? 'Demo Compact' : 'Demo Economy',
        coverImageUrl:
          plate === 'DM010AA'
            ? 'https://picsum.photos/seed/demo-rent-car-a/640/400'
            : plate === 'DM011AA'
              ? 'https://picsum.photos/seed/demo-rent-car-b/640/400'
              : 'https://picsum.photos/seed/demo-rent-car-c/640/400',
      },
    });
  }

  await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      passwordHash,
      firstName: 'Admin',
      lastName: 'Demo',
      companyId,
      role: 'ADMIN',
      stationId: null,
    },
    update: {
      passwordHash,
      companyId,
      role: 'ADMIN',
      stationId: null,
      isActive: true,
    },
  });

  await prisma.user.upsert({
    where: { email: agentEmail },
    create: {
      email: agentEmail,
      passwordHash,
      firstName: 'Agent',
      lastName: 'Demo',
      companyId,
      role: 'AGENT',
      stationId: stationMilan.id,
    },
    update: {
      passwordHash,
      companyId,
      role: 'AGENT',
      stationId: stationMilan.id,
      isActive: true,
    },
  });

  const availableCount = await prisma.vehicle.count({
    where: { companyId, status: 'AVAILABLE' },
  });

  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log('━━━ Demo seed complete ━━━');
  // eslint-disable-next-line no-console
  console.log(`  Company:     ${company.name} (${companyId})`);
  // eslint-disable-next-line no-console
  console.log(`  Stations:    ${stations.map((s) => `${s.code} (${s.name})`).join(' · ')}`);
  // eslint-disable-next-line no-console
  console.log(`  Fleet:       ECON + COMPACT · ${availableCount} vehicle(s) AVAILABLE`);
  // eslint-disable-next-line no-console
  console.log(`  Web:         set NEXT_PUBLIC_DEFAULT_COMPANY_ID=${companyId} in apps/web/.env.local`);
  // eslint-disable-next-line no-console
  console.log(`  Sign in:     ${adminEmail}   |   ${agentEmail} (AGENT @ ${stationMilan.code})`);
  // eslint-disable-next-line no-console
  console.log(`  Password:    ${password}`);
  // eslint-disable-next-line no-console
  console.log('');
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
