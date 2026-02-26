import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function sessionWatcher(idSession) {
  if (!idSession) {
    console.error("Session ID is required.");
    return false;
  }

  try {
    const session = await prisma.session.findUnique({
      where: { id: idSession },
    });

    if (!session) {
      console.error("Session not found.");
      return false;
    }

    const now = new Date();
    const sessionDate = new Date(session.date);

    if (now > sessionDate) {
      await prisma.session.delete({
        where: { id: idSession },
      });
      return true;
    }

    await prisma.session.update({
      where: { id: idSession },
      data: { lastAccessedAt: now },
    });

    return false;
  } catch (error) {
    console.error("Error in sessionWatcher:", error.message);
    return false;
  }
}

export default sessionWatcher;