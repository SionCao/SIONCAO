// Create connection to Node.js Server
const socket = io();

let gameFull = false;
let me = null;// will store unique socket id of client

//mirror object of what will be on the server
let experienceState = {
  users: {},
  resultMessage: null,
  winner: null
};
// for making our graphics just a tiny bit more fun
let emojiDictionary = {
  rock: "✊️",
  paper: "🖐️",
  scissors: "✌️"
};

let myChoice = null;

function setup() {
  createCanvas(400, 300);
  textAlign(CENTER, CENTER);
  textSize(16);

}

function draw() {
  background(240);

  if(gameFull){
    //Game full message
    text("Game already has 2 users", width / 2, 30);
  }else{
    //Instructions
    text("Rock Paper Scissors", width / 2, 30);
    text("press r, p, or s", width / 2, 60);

    // Choices 
    let choicesMade = 0;
    for (let id in experienceState.users) {
      if (experienceState.users[id].choice) {
        choicesMade++;
      }
      if(me == id && experienceState.users[id].choice){
        let myChoice = experienceState.users[id].choice;
        let emoji = emojiDictionary[myChoice];//use the word as look up for the key
        text("Your choice: " + emoji , width / 2, 110);
      }
    }

    text("Choices made: " + choicesMade + " / 2", width / 2, 140);

    //Results
    if (experienceState.resultMessage) {
      if(experienceState.winner == me){
        text("You win!", width / 2, 200);
      }else{
        text("You didn't win.", width / 2, 200);
      }
      text("Result: " + experienceState.resultMessage, width / 2, 230);
      text("Refresh to play again", width / 2, 260);
    }
  }

 
}

function keyPressed() {
  if (key == 'r') {
    sendChoice("rock");
  }
  if (key == 'p'){
    sendChoice("paper");
  } 
  if (key == 's'){
    sendChoice("scissors");
  } 
}

function sendChoice(choice) {

  //check if i have already sent my choice to the server
  if(experienceState.users[me].choice !== null){
    console.log("You have already chosen for this round!");
    return; // prevent re-choosing by exiting early
  }

  socket.emit("update", {
    choice: choice
  });
}

//---------------------
// SOCKET EVENTS
//---------------------


socket.on("state", (state) => {
  console.log(state);
  experienceState = state;
});

socket.on("full", () => {
  gameFull = true;
});

socket.on("connect", () => {
  console.log(socket.id);
  me = socket.id;// store my socket id 
});