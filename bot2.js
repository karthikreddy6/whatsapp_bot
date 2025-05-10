// 1. Import libraries
const { Client, LocalAuth } = require('whatsapp-web.js');
const admin = require('firebase-admin');
const qrcode = require('qrcode-terminal'); // Import QR code terminal
const fs = require('fs'); // For file system operations
const serviceAccount = require('./onfood-adminsdk.json'); // Your Firebase SDK service account

// 2. Initialize Firebase Admin with your provided URL
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://onfood-587eb-default-rtdb.firebaseio.com/' // Use the URL you provided
});

const db = admin.database(); // Firebase Realtime Database

// 3. Initialize WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});

// 4. QR Code Display in Terminal
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true }); // Generate QR code in terminal
});

// 5. Ready Event - Start Listening for Orders
client.on('ready', () => {
    console.log('WhatsApp client is ready!');
    listenForOrders(); // Call function to listen for new orders
});

// Error handling for WhatsApp client connection issues
client.on('error', (error) => {
    console.error('WhatsApp client encountered an error:', error);
});

// 6. Firebase Realtime DB - Listen for New Orders and Status Changes
let lastProcessedTimestamp = 0; // Variable to store the timestamp of the last processed order

// Try to load the last processed timestamp from a local file to persist data across restarts
const loadLastProcessedTimestamp = () => {
    try {
        const data = fs.readFileSync('lastProcessedTimestamp.json', 'utf8');
        const parsedData = JSON.parse(data);
        return parsedData.timestamp || 0; // If no data found, return 0
    } catch (error) {
        return 0; // If file doesn't exist or there's an error, return 0
    }
};

// Save the last processed timestamp to a local file
const saveLastProcessedTimestamp = (timestamp) => {
    const data = { timestamp };
    fs.writeFileSync('lastProcessedTimestamp.json', JSON.stringify(data), 'utf8');
};

// Initialize the last processed timestamp on server startup
lastProcessedTimestamp = loadLastProcessedTimestamp();

function listenForOrders() {
    const ordersRef = db.ref('Orders'); // Reference to the "Orders" node in Firebase
    console.log('Listening for new orders and status updates...');

    // Listen for newly added orders (Live Orders)
    ordersRef.on('child_added', async (snapshot) => {
        const order = snapshot.val(); // Get order data from Firebase

        // Skip processing if the order's timestamp is less than or equal to the last processed timestamp
        if (!order || order.timestamp <= lastProcessedTimestamp) {
            return;
        }

        // Update lastProcessedTimestamp to ensure future orders are only processed once
        lastProcessedTimestamp = order.timestamp;

        // Save the updated timestamp to the file for persistence across restarts
        saveLastProcessedTimestamp(lastProcessedTimestamp);

        const userPhone = order.userPhone;
        const username = order.username;
        const orderDate = order.orderDate;
        const orderTime = order.orderTime;
        const status = order.status;
        const items = order.items;

        // Format items text
        let itemsText = '';
        for (const key in items) {
            const item = items[key];
            itemsText += `• ${item.name} (x${item.quantity}) - ₹${item.price}\n`;
        }

        // Create message text to send to WhatsApp
        const message = `🍽️ *New Order Received!*\n\n👤 *Customer:* ${username}\n📞 *Phone:* ${userPhone}\n📅 *Date:* ${orderDate}\n⏰ *Time:* ${orderTime}\n\n🛒 *Items:*\n${itemsText}\n🚚 *Status:* ${status}`;

        const whatsappNumber = `91${userPhone}@c.us`; // Format phone number for WhatsApp

        try {
            // Send message to the customer using their phone number
            await client.sendMessage(whatsappNumber, message);
            console.log(`✅ Order message sent to ${userPhone}`);
        } catch (error) {
            console.error(`❌ Failed to send message to ${userPhone}:`, error);
        }
    });

    // Listen for updates to existing orders (Order Status Changes)
    ordersRef.on('child_changed', async (snapshot) => {
        const order = snapshot.val(); // Get order data from Firebase

        // Skip processing if the order's timestamp is less than or equal to the last processed timestamp
        if (!order || order.timestamp <= lastProcessedTimestamp) {
            return;
        }

        const userPhone = order.userPhone;
        const username = order.username;
        const orderDate = order.orderDate;
        const orderTime = order.orderTime;
        const newStatus = order.status;

        const whatsappNumber = `91${userPhone}@c.us`; // Format phone number for WhatsApp

        try {
            // Handle different status changes
            if (newStatus === 'confirmed') {
                // Order is confirmed
                const confirmMessage = `✅ *Your order has been confirmed!* We'll begin preparing your food soon.`;
                await client.sendMessage(whatsappNumber, confirmMessage);
                console.log(`✅ Sent confirmation message to ${userPhone}`);
            } else if (newStatus === 'cooking') {
                // Order is being cooked
                const cookingMessage = `🍳 *Your order is now being prepared!* We'll notify you once it's ready for delivery.`;
                await client.sendMessage(whatsappNumber, cookingMessage);
                console.log(`✅ Sent cooking message to ${userPhone}`);
            } else if (newStatus === 'delivered') {
                // Order is delivered
                const deliveredMessage = `🎉 *Thank you for your order!* We hope you enjoyed your meal. Come back soon!`;
                await client.sendMessage(whatsappNumber, deliveredMessage);
                console.log(`✅ Sent thank you message to ${userPhone}`);
            }

            // Update lastProcessedTimestamp to ensure we don't process the same order again
            lastProcessedTimestamp = order.timestamp;

            // Save the updated timestamp to the file for persistence across restarts
            saveLastProcessedTimestamp(lastProcessedTimestamp);

        } catch (error) {
            console.error(`❌ Failed to send status update message to ${userPhone}:`, error);
        }
    });

    // Handle any Firebase connection errors
    ordersRef.on('error', (error) => {
        console.error('Firebase Realtime DB error:', error);
    });
}

client.initialize();
