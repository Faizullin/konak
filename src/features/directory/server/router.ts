import "server-only";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { requireOrgMember } from "@/server/auth";
import { requireOrgModule } from "@/features/organizations/server";
import { fieldError } from "@/server/errors";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import {
  blankToNull,
  canArchivePeople,
  canManageCompanies,
  canManagePeople,
  canReadDirectory,
  createCompanySchema,
  createPersonSchema,
  linkPersonSchema,
  listCompaniesSchema,
  listPeopleSchema,
  normalizeEmail,
  updateCompanySchema,
  updatePersonSchema,
  type AddressInput,
} from "../model";

/**
 * Directory — the people and companies an organization deals with.
 *
 * Every procedure resolves the organization through `requireOrgMember` first,
 * and every query carries `organizationId`. A missing scope here is a
 * cross-tenant leak, not a bug in a list.
 */

function addressCreate(address: AddressInput | undefined) {
  if (!address) return undefined;
  return {
    create: {
      line1: address.line1,
      line2: blankToNull(address.line2),
      city: blankToNull(address.city),
      region: blankToNull(address.region),
      postalCode: blankToNull(address.postalCode),
      countryCode: address.countryCode,
    },
  };
}

/** OWNER and ADMIN see archived rows; everyone else works with the live book. */
function archiveFilter(includeArchived: boolean | undefined) {
  return includeArchived ? {} : { archivedAt: null };
}

export const directoryRouter = createTRPCRouter({
  listPeople: protectedProcedure.input(listPeopleSchema).query(async ({ ctx, input }) => {
    await requireOrgModule(input.organizationId, "DIRECTORY");
    const { role } = await requireOrgMember(ctx, input.organizationId);
    if (!canReadDirectory(role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "No access to the directory" });
    }

    const { filter, orderBy, pagination } = input;
    const where: Prisma.PersonWhereInput = {
      organizationId: input.organizationId,
      ...archiveFilter(filter?.includeArchived),
      ...(filter?.companyId ? { companies: { some: { companyId: filter.companyId } } } : {}),
      ...(filter?.search
        ? {
            OR: [
              { firstName: { contains: filter.search } },
              { lastName: { contains: filter.search } },
              { email: { contains: filter.search } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      ctx.db.person.findMany({
        where,
        orderBy: orderBy ? { [orderBy.field]: orderBy.direction } : { lastName: "asc" },
        skip: pagination.skip,
        take: pagination.take,
        include: { address: true, companies: { include: { company: true } } },
      }),
      ctx.db.person.count({ where }),
    ]);

    return { items, total, meta: { skip: pagination.skip, take: pagination.take } };
  }),

  getPerson: protectedProcedure
    .input(z.object({ organizationId: z.number(), id: z.number() }))
    .query(async ({ ctx, input }) => {
      const { role } = await requireOrgMember(ctx, input.organizationId);
      if (!canReadDirectory(role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No access to the directory" });
      }

      // The organization is part of the lookup, not checked after it: a row
      // from another tenant must be indistinguishable from one that is absent.
      const person = await ctx.db.person.findFirst({
        where: { id: input.id, organizationId: input.organizationId },
        include: { address: true, companies: { include: { company: true } } },
      });
      if (!person) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
      }
      return person;
    }),

  createPerson: protectedProcedure.input(createPersonSchema).mutation(async ({ ctx, input }) => {
    const { user, role } = await requireOrgMember(ctx, input.organizationId);
    if (!canManagePeople(role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You cannot add people" });
    }

    const email = normalizeEmail(input.email);
    if (email) {
      const existing = await ctx.db.person.findFirst({
        where: { organizationId: input.organizationId, email },
        select: { id: true },
      });
      if (existing) {
        throw fieldError(
          "email",
          "Someone with that email is already in the directory",
          "CONFLICT"
        );
      }
    }

    return ctx.db.person.create({
      data: {
        organization: { connect: { id: input.organizationId } },
        firstName: input.firstName,
        lastName: input.lastName,
        email,
        phone: blankToNull(input.phone),
        dateOfBirth: input.dateOfBirth,
        notes: blankToNull(input.notes),
        address: addressCreate(input.address),
        createdById: user.id,
        updatedById: user.id,
      },
    });
  }),

  updatePerson: protectedProcedure
    .input(updatePersonSchema.extend({ organizationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { user, role } = await requireOrgMember(ctx, input.organizationId);
      if (!canManagePeople(role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot edit people" });
      }

      const person = await ctx.db.person.findFirst({
        where: { id: input.id, organizationId: input.organizationId },
        select: { id: true },
      });
      if (!person) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
      }

      const email = input.email === undefined ? undefined : normalizeEmail(input.email);
      if (email) {
        const clash = await ctx.db.person.findFirst({
          where: { organizationId: input.organizationId, email, id: { not: input.id } },
          select: { id: true },
        });
        if (clash) {
          throw fieldError("email", "Someone else already uses that email", "CONFLICT");
        }
      }

      return ctx.db.person.update({
        where: { id: input.id },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          email,
          phone: input.phone === undefined ? undefined : blankToNull(input.phone),
          dateOfBirth: input.dateOfBirth,
          notes: input.notes === undefined ? undefined : blankToNull(input.notes),
          updatedById: user.id,
        },
      });
    }),

  archivePerson: protectedProcedure
    .input(z.object({ organizationId: z.number(), id: z.number(), archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const { user, role } = await requireOrgMember(ctx, input.organizationId);
      if (!canArchivePeople(role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can archive people" });
      }

      const person = await ctx.db.person.findFirst({
        where: { id: input.id, organizationId: input.organizationId },
        select: { id: true },
      });
      if (!person) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
      }

      return ctx.db.person.update({
        where: { id: input.id },
        data: { archivedAt: input.archived ? new Date() : null, updatedById: user.id },
      });
    }),

  listCompanies: protectedProcedure.input(listCompaniesSchema).query(async ({ ctx, input }) => {
    const { role } = await requireOrgMember(ctx, input.organizationId);
    if (!canReadDirectory(role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "No access to the directory" });
    }

    const { filter, orderBy, pagination } = input;
    const where: Prisma.CompanyWhereInput = {
      organizationId: input.organizationId,
      ...archiveFilter(filter?.includeArchived),
      ...(filter?.search ? { name: { contains: filter.search } } : {}),
    };

    const [items, total] = await Promise.all([
      ctx.db.company.findMany({
        where,
        orderBy: orderBy ? { [orderBy.field]: orderBy.direction } : { name: "asc" },
        skip: pagination.skip,
        take: pagination.take,
        include: { address: true, _count: { select: { people: true } } },
      }),
      ctx.db.company.count({ where }),
    ]);

    return { items, total, meta: { skip: pagination.skip, take: pagination.take } };
  }),

  createCompany: protectedProcedure.input(createCompanySchema).mutation(async ({ ctx, input }) => {
    const { user, role } = await requireOrgMember(ctx, input.organizationId);
    if (!canManageCompanies(role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You cannot add companies" });
    }

    const taxId = blankToNull(input.taxId);
    if (taxId) {
      const existing = await ctx.db.company.findFirst({
        where: { organizationId: input.organizationId, taxId },
        select: { id: true },
      });
      if (existing) {
        throw fieldError("taxId", "A company with that tax id already exists", "CONFLICT");
      }
    }

    return ctx.db.company.create({
      data: {
        organization: { connect: { id: input.organizationId } },
        name: input.name,
        legalName: blankToNull(input.legalName),
        taxId,
        email: normalizeEmail(input.email),
        phone: blankToNull(input.phone),
        website: blankToNull(input.website),
        notes: blankToNull(input.notes),
        address: addressCreate(input.address),
        createdById: user.id,
        updatedById: user.id,
      },
    });
  }),

  updateCompany: protectedProcedure
    .input(updateCompanySchema.extend({ organizationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { user, role } = await requireOrgMember(ctx, input.organizationId);
      if (!canManageCompanies(role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot edit companies" });
      }

      const company = await ctx.db.company.findFirst({
        where: { id: input.id, organizationId: input.organizationId },
        select: { id: true },
      });
      if (!company) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
      }

      return ctx.db.company.update({
        where: { id: input.id },
        data: {
          name: input.name,
          legalName: input.legalName === undefined ? undefined : blankToNull(input.legalName),
          email: input.email === undefined ? undefined : normalizeEmail(input.email),
          phone: input.phone === undefined ? undefined : blankToNull(input.phone),
          website: input.website === undefined ? undefined : blankToNull(input.website),
          notes: input.notes === undefined ? undefined : blankToNull(input.notes),
          updatedById: user.id,
        },
      });
    }),

  linkPerson: protectedProcedure
    .input(linkPersonSchema.extend({ organizationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { role } = await requireOrgMember(ctx, input.organizationId);
      if (!canManagePeople(role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot change directory links" });
      }

      // Both sides are checked against the caller's organization: without this
      // a link could join a local person to another tenant's company.
      const [person, company] = await Promise.all([
        ctx.db.person.findFirst({
          where: { id: input.personId, organizationId: input.organizationId },
          select: { id: true },
        }),
        ctx.db.company.findFirst({
          where: { id: input.companyId, organizationId: input.organizationId },
          select: { id: true },
        }),
      ]);
      if (!person || !company) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Person or company not found" });
      }

      return ctx.db.personCompany.upsert({
        where: { personId_companyId: { personId: input.personId, companyId: input.companyId } },
        create: {
          personId: input.personId,
          companyId: input.companyId,
          jobTitle: blankToNull(input.jobTitle),
          isPrimary: input.isPrimary,
        },
        update: { jobTitle: blankToNull(input.jobTitle), isPrimary: input.isPrimary },
      });
    }),
});
