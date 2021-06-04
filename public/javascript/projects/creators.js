const creatorSelect = document.getElementById('creator-select');
const creatorDiv = document.getElementById('creator-input-div');
const creatorInput = document.getElementById('creator-input');
let creatorList = [];

$("#project-image").hide();
for (let creator of document.getElementsByClassName('user-tag')) {
    creatorList.push(creator.id)
    creatorInput.value = creatorList.toString()
}

const searchCreators = function(input) {
    const url = `/projects/search-creators`;
    const data = {text: input.value};
    let appendedCreator;

    if (input.value.length > 2) {
        sendPostReq(url, data, data => {
            if (data.success && data.creators.length > 0) { //If there are creators to display
                creatorSelect.hidden = false;
                while (creatorSelect.firstChild) {creatorSelect.removeChild(creatorSelect.firstChild);} //Empty creatorSelect from previous searches

                //Add heading back to creatorSelect's list
                const heading = document.createElement("option");
                for (let attr of ["selected", "disabled"]) {heading[attr] = true;}
                heading.className = "creator-group";
                heading.innerText = "Select User/Group";
                creatorSelect.appendChild(heading);

                for (let recType of ["status", "user"]) {
                    for (let creator of data.creators) { //Build creatorSelect option
                        if (creator.type == recType) {
                            appendedCreator = document.createElement("option");
                            if (recType == "user") {
                                appendedCreator.className = creator.classValue;
                            } else {
                                appendedCreator.className = "creator-group";
                            }

                            appendedCreator.innerText = creator.displayValue;
                            appendedCreator.setAttribute("value", creator.idValue);
                            creatorSelect.appendChild(appendedCreator); //Add creatorSelect option to menu
                        }
                    }
                }
            } else {
                creatorSelect.hidden = true; //Hide dropdown if there are no matching elements
            }
        });
    } else {
        creatorSelect.hidden = true; //Hide dropdown if there is not a long enough input string
    }
}

const addCreator = function () { //Add creator to list of creators
    if ((!creatorList.includes(creatorSelect.value)) && !(creatorList.includes(creatorSelect[creatorSelect.selectedIndex].className))) { //Make sure that if the status has been selected, nothing else is selected
        creatorList.push(creatorSelect.value);
        creatorInput.value = creatorList.toString();

        let newCreator = document.createElement('div');
        newCreator.classList.add('user-tag');
        newCreator.classList.add(`${creatorSelect[creatorSelect.selectedIndex].className}`); //Put the user status in the tag
        newCreator.id = `${creatorSelect.value}`;
        newCreator.innerHTML = `<span name="creators" value="${creatorSelect.value}">${creatorSelect.options[creatorSelect.selectedIndex].text}</span><button type="button" id="${creatorSelect.value}" onclick="remCreator(this)">&times;</button>`;
        creatorDiv.appendChild(newCreator);

        let deletes = []; //List of usernames to be removed

        for (let t = 0; t < document.getElementsByClassName('user-tag').length; t++) { //Go through list of creators, remove any users who have this className (if the added 'username' is a status e.g. '12th', it removes any excess 12th graders)
            if (document.getElementsByClassName('user-tag')[t].classList.contains(creatorSelect[creatorSelect.selectedIndex].value)) {
                deletes.push(t);
            }
        }

        for (let del of deletes.reverse()) { //Iterate through list of usernames to remove
            remCreator(document.getElementsByClassName('user-tag')[del].getElementsByTagName('button')[0]);
        }
    }
    //Empty input and hide dropdown
    document.getElementById("creator-list").value = "";
    creatorSelect.hidden = true;
}

const remCreator = function (btn) { //Remove creator from list of creators
    const id = btn.id;

    const userTags = document.getElementsByClassName('user-tag');
    for (let tag of userTags) { //Iterate through tags until the one with the remove ID is found
        if (tag.id == id) {
            creatorDiv.removeChild(tag);
            creatorList.splice(creatorList.indexOf(id), 1);
            creatorInput.value = creatorList.toString();
        }
    }
}
