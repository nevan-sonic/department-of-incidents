const { ethers } = require("ethers");
const pk = "0x616355559f3b9880cf878749d4d8b42f5b7c9147552ce03793de353f9d3ef00d";
const wallet = new ethers.Wallet(pk);
console.log("Derived Address:", wallet.address);
