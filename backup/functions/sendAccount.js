import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function sendAccount(searchKey) {
    try {
        const searchCriteria = searchKey ? {
            OR: [
                { email: { contains: searchKey, mode: 'insensitive' } },
                { contact: { phone: { contains: searchKey, mode: 'insensitive' } } },
                { contact: { firstName: { contains: searchKey, mode: 'insensitive' } } },
                { contact: { lastName: { contains: searchKey, mode: 'insensitive' } } },
            ]
        } : {};

        let accounts = await prisma.account.findMany({
            where: searchCriteria,
            include: {
                contact: true,
                sessions: true,
            },
        });

        accounts = accounts.map(account => {
            delete account.password;
            if (account.contact.picture) {
                account.contact.picture = `${process.env.HOST}/files/img/profile${account.contact.picture}`;
            }
            return account;
        });

        return accounts;
    } catch (error) {
        console.error("Error fetching accounts:", error);
        throw error;
    }
}

export default sendAccount;