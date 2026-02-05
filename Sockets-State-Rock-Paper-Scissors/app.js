//// REMOVE IF YOU PUT ON RENDER //////
import open, {openApp, apps} from 'open';//only needed for a simple development tool remove if hosting online see above
//// REMOVE IF YOU PUT ON RENDER //////

import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 4400;

app.use(express.static("public"));

server.listen(port, () => {
  console.log("Listening on http://localhost:" + port);
});

//// REMOVE IF YOU PUT ON RENDER //////
//open in browser: dev environment only!
await open(`http://localhost:${port}`);//opens in your default browser
//// REMOVE IF YOU PUT ON RENDER //////

/*
  EXPERIENCE STATE
  Everything about the experience lives here.
*/
let experienceState = {
  users: {},          // socket.id -> { choice }
  resultMessage: null,  // text result to display
  winner: null          // winner ID 
};

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

 
  let userIDs = Object.keys(experienceState.users);//returns array of key values from javascript object
  // Only allow 2 users
  if (userIDs.length >= 2) {
    socket.emit("full");//so other users can't join
    return;
  }

  //join a room
  socket.join("gameRoom");

  //store user socket id in the experience state
  experienceState.users[socket.id] = {
    choice: null
  };

  //send the message to only the two in the game
  io.to("gameRoom").emit("state", experienceState);

  //listening for updates on that socket
  socket.on("update", (data) => {
    //  console.log(data);
    /*
      data = { choice: "rock" }
    */
  
    //Just in case we get hacked / if the user is not in the experience state list of users
    if (experienceState.users[socket.id] == false) {
      return; // then exit / stop running the function
    } 

    //assign choice to user 
    experienceState.users[socket.id].choice = data.choice;

    let userIds = Object.keys(experienceState.users);

    // Check if both users have chosen
    if (
      userIds.length == 2 &&
      experienceState.users[userIds[0]].choice &&
      experienceState.users[userIds[1]].choice
    ) {

      //check who has won
      let outcome = determineWinner(userIds[0],userIds[1]);

      experienceState.resultMessage = outcome.message;
      experienceState.winner = outcome.winner;
    }

    //emit messages only to those in the room
    io.to("gameRoom").emit("state", experienceState);
  });

  socket.on("disconnect", () => {
    //remove choices for all in the game / do a reset of the game
    for (let id in experienceState.users) {
      experienceState.users[id].choice = null;
    }
    //reset the results
    experienceState.resultMessage = null;
    experienceState.winner = null;

    //remove user that just disconnected
    delete experienceState.users[socket.id];

    //emit messages any remaining sockets listening in the room
    io.to("gameRoom").emit("state", experienceState);
  });
});


//Custom Functions below
function determineWinner(user1ID,user2ID) {
  const u1 = experienceState.users[user1ID].choice;
  const u2 = experienceState.users[user2ID].choice;

  if (u1 === u2){
    return {
      message: "Draw",
      winner: null
    };
  } 

  if (
    (u1 === "rock" && u2 === "scissors") ||
    (u1 === "paper" && u2 === "rock") ||
    (u1 === "scissors" && u2 === "paper")
  ) { 
    return {
      message: u1 + " wins against " + u2,
      winner: user1ID
    };
  } else {
    return{
      message: u2 + " wins against " + u1,
      winner: user2ID
    };
  }
}