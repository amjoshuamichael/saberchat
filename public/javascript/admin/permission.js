const updateRole = function (select) { //Update user's permission
    const loading = document.getElementById('loading'); //Button which shows request status
    loading.style.display = 'block';
    loading.style.color = 'gray';
    loading.innerHTML = 'Waiting...';
    const role = select.value;
    const url = '/admin/permissions?_method=put';
    const userId = select.id;
    const data = {userId, role};
    $.post(url, data, data => { 
        if (data.success) { //If successful, display success info
            loading.style.color = 'green';
            loading.innerHTML = data.success;
        } else if (data.error) { //If unsuccessful, display error message
            loading.style.color = 'red';
            loading.innerHTML = data.error;
        }

        setTimeout(() => { //After a minute, hide the message
            loading.style.display = "none";
        }, 1000);

        if (data.user) { //If a user was updated, change their displayed permission
            for (let option of select) {
                if (option.value == data.user.permission) {
                    option.selected = true;
                }
            }
        }
    });
}

const searchFunction = function() { //Function to search for user info within body
    const users = document.getElementsByClassName('user');
    const searchInput = document.getElementById('search-input');
    let filter = searchInput.value.toLowerCase();

    for (let i = 0; i < users.length; i += 1) { //Iterate through user list and see if any text/class names match the search input
        if ((users[i].textContent.split('\n')[1].toLowerCase().includes(filter) || users[i].classList.toString().toLowerCase().includes(filter.toLowerCase()))) {
            users[i].hidden = false;
        } else {
            users[i].hidden = true;
        }
    }
}
