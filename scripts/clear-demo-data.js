import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log("Starting demo data clearing process...");
    
    try {
        // Delete in order to avoid foreign key constraint errors
        console.log("Deleting AudienceMemberships...");
        await prisma.audienceMembership.deleteMany({});
        
        console.log("Deleting SessionRecordings...");
        await prisma.sessionRecording.deleteMany({});
        
        console.log("Deleting ConfiguratorProgress...");
        await prisma.configuratorProgress.deleteMany({});
        
        console.log("Deleting Events...");
        await prisma.event.deleteMany({});
        
        console.log("Deleting Sessions...");
        await prisma.session.deleteMany({});
        
        console.log("Deleting Orders...");
        await prisma.order.deleteMany({});
        
        console.log("Deleting Visitors...");
        await prisma.visitor.deleteMany({});

        console.log("✅ Successfully cleared all demo data! AdminUsers were preserved.");
    } catch (e) {
        console.error("Error clearing demo data:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
