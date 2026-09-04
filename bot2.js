// 1. Import libraries
const { Client, LocalAuth } = require('whatsapp-web.js');
const firebase = require('firebase/compat/app');
require('firebase/compat/database');
const qrcode = require('qrcode-terminal'); // Import QR code terminal
const fs = require('fs'); // For file system operations

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBwYwaLjclLq9OHbjEhkUh-oKqV38qSEpk",
  authDomain: "onfood-587eb.firebaseapp.com",
  databaseURL: "https://onfood-587eb-default-rtdb.firebaseio.com",
  projectId: "onfood-587eb",
  storageBucket: "onfood-587eb.appspot.com",
  messagingSenderId: "576989448271",
  appId: "1:576989448271:web:bf0e0e7d47af87befa823a",
  measurementId: "G-E1S3MQP5RT"
};

// 2. Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database(); // Firebase Realtime Database

// 3. Initialize WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "onfood-bot"
    }),
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ],
        protocolTimeout: 0,
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

    const safeOrderHandler = async (snapshot) => {
        try {
            const order = snapshot.val();
            if (!order) return;

            // ... rest of logic for child_added/child_changed
        } catch (error) {
            console.error('Error in order handler:', error);
        }
    };

    ordersRef.on('child_added', async (snapshot) => {
        try {
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

            // Check if number is registered and get correct JID
            const numberId = await client.getNumberId(whatsappNumber);
            const targetId = numberId ? numberId._serialized : whatsappNumber;
            const chat = await client.getChatById(targetId);
            await chat.sendMessage(message);
            console.log(`✅ Order message sent to ${userPhone}`);
        } catch (error) {
            console.error(`❌ Failed to send message to ${snapshot.key}:`, error.message);
        }
    });

    // Listen for updates to existing orders (Order Status Changes)
    ordersRef.on('child_changed', async (snapshot) => {
        try {
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

            const numberId = await client.getNumberId(whatsappNumber);
            const targetId = numberId ? numberId._serialized : whatsappNumber;
            const chat = await client.getChatById(targetId);

            // Handle different status changes
            if (newStatus === 'confirmed') {
                // Order is confirmed
                const confirmMessage = `✅ *Your order has been confirmed!* We'll begin preparing your food soon.`;
                await chat.sendMessage(confirmMessage);
                console.log(`✅ Sent confirmation message to ${userPhone}`);
            } else if (newStatus === 'cooking') {
                // Order is being cooked
                const cookingMessage = `🍳 *Your order is now being prepared!* We'll notify you once it's ready for delivery.`;
                await chat.sendMessage(cookingMessage);
                console.log(`✅ Sent cooking message to ${userPhone}`);
            } else if (newStatus === 'delivered') {
                // Order is delivered
                const deliveredMessage = `🎉 *Thank you for your order!* We hope you enjoyed your meal. Come back soon!`;
                await chat.sendMessage(deliveredMessage);
                console.log(`✅ Sent thank you message to ${userPhone}`);
            }

            // Update lastProcessedTimestamp to ensure we don't process the same order again
            lastProcessedTimestamp = order.timestamp;

            // Save the updated timestamp to the file for persistence across restarts
            saveLastProcessedTimestamp(lastProcessedTimestamp);
        } catch (error) {
            console.error(`❌ Failed to send status update message to ${snapshot.key}:`, error.message);
        }
    });

    // Handle any Firebase connection errors
    ordersRef.on('error', (error) => {
        console.error('Firebase Realtime DB error:', error);
    });
}

client.initialize();
