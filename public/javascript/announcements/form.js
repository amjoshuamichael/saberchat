const imgContainer = document.getElementById('image-block');
let i = 0;

const addImg = function () { //Add image input field
    const img = document.createElement('div');
    img.classList.add('image-group');
    img.id = `block-${i}`;
    img.innerHTML = `<div class="input-container"><input type="text" id="${i}" class="form-control mode" oninput="createImg(this)" placeholder="Url..." name="images[${i}]" required></div><button type="button" onclick="deleteImg(this)" style="display: inline;" class="btn btn-danger"><i class="fas fa-minus"></i></button>`;
    imgContainer.prepend(img);
    i++;
}

const createImg = function (val) { //Creates an image based on value of image input
    if ($(`#block-${val.id}`).find('img').length == 0) { //If an image has not been created yet, create one
        const imageDisplay = document.createElement('img');
        imageDisplay.id = `image-${val.id}`;

        if (val.value.split(' ').join('') != '') { //If some input has been entered, build the image
            imageDisplay.src = val.value;
            imageDisplay.alt = "Image Does Not Exist"; //Display if image does not exist
            imageDisplay.style = "width: 40%; height: 40%; margin-top: 10px; border-radius: 15px;";
            document.getElementById(`block-${val.id}`).appendChild(imageDisplay);
        }

    } else { //If an image has been created, update it
        if (val.value.split(' ').join('') != '') {
            $(`#block-${val.id}`).find('img')[0].src = val.value;
            $(`#${$(`#block-${val.id}`).find('img')[0].id}`).show();

        } else {
            $(`#${$(`#block-${val.id}`).find('img')[0].id}`).hide();
        }
    }
}

const deleteImg = function (btn) { //Remove input field and corresponding image
    const parent = btn.parentNode;
    parent.remove();
}
