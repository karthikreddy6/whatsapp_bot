// 1. Import libraries
const { Client, LocalAuth } = require('whatsapp-web.js');
const admin = require('firebase-admin');
const qrcode = require('qrcode-terminal'); // Import QR code terminal
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

client.initialize();

// 6. Firebase Realtime DB - Listen for New Orders
function listenForOrders() {
    const ordersRef = db.ref('Orders'); // Reference to the "Orders" node in Firebase
    console.log('Listening for new orders...');

    // Listen for newly added orders
    ordersRef.on('child_added', async (snapshot) => {
        const order = snapshot.val(); // Get order data from Firebase

        if (!order) return; // Skip if there's no order data

        const userPhone = order.userPhone; // Get user phone number from the order
        const username = order.username; // Get user name from the order
        const orderDate = order.orderDate; // Order date
        const orderTime = order.orderTime; // Order time
        const status = order.status; // Order status
        const items = order.items; // Items in the order

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
            // Handle any errors while sending message
            console.error(`❌ Failed to send message to ${userPhone}:`, error);
        }
    });
}
