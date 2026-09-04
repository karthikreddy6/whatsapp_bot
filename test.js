const express = require('express');
const app = express();

app.use(express.json()); // Middleware to parse JSON bodies

app.post('/hello',(req,res)=>{
    const name = req.body;
    res.send(`Hello mg `);
    console.log(name);
});

app.listen(2500,()=> console.log('Server is running on port 2500'));    